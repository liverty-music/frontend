import { registerZoneNames } from '../../../shared/lib/zoned-time/zone-name'
import { BindingMode, bindable, ILogger, resolve } from 'aurelia'
import { IConsoleLanguage } from '../../i18n/console-language'
import type { FieldError } from '../../i18n/field-error'
import { IClock } from '../../services/clock'
import {
	type CountryAreas,
	IVenueClient,
	type VenuePick,
} from '../../services/venue-client'
import {
	type FieldErrorText,
	fieldErrorOf,
} from '../console-field/console-field'
import {
	type AreaGroup,
	areaGroups,
	areaNameOf,
	areaZone,
	type Choice,
	countryChoices,
	type VenueConfirmation,
	zoneChoices,
	zoneNameOf,
} from './venue-confirm-model'

export type { VenueConfirmation } from './venue-confirm-model'

/** Where the field stands: nothing picked, reading, shown, or unreadable. */
export type VenueConfirmPhase = 'idle' | 'loading' | 'ready' | 'unavailable'

let nextId = 0

/**
 * Shows what a picked place will be and, for a place no Venue holds yet,
 * lets the member confirm its name, country, area and time zone before the
 * event is saved. It reads the place with VenueService.ResolvePlace, the
 * countries with AreaService.ListCountries and the chosen country's Areas,
 * regions and zones with AreaService.ListByCountry.
 *
 * `confirmation` carries what the member left in the field, replaced on
 * every change; it is null while nothing is picked or the place could not be
 * read, so the event has no venue.
 */
export class VenueConfirm {
	private readonly logger = resolve(ILogger).scopeTo('VenueConfirm')
	private readonly venues = resolve(IVenueClient)
	private readonly language = resolve(IConsoleLanguage)
	private readonly clock = resolve(IClock)

	/** The place the member picked; null until one is picked. */
	@bindable public pick: VenuePick | null = null
	@bindable({ mode: BindingMode.twoWay })
	public confirmation: VenueConfirmation | null = null
	@bindable public nameError: FieldErrorText = ''
	@bindable public areaError: FieldErrorText = ''
	@bindable public zoneError: FieldErrorText = ''

	public readonly idPrefix = `venue-confirm-${nextId++}`
	public phase: VenueConfirmPhase = 'idle'
	public kind: 'venue' | 'draft' = 'draft'
	public name = ''
	public countryCode = ''
	public area = ''
	public zone = ''
	public countries: Choice[] = []
	public groups: AreaGroup[] = []
	public zones: Choice[] = []
	/** The chosen country's Areas and zones; null until read. */
	private country: CountryAreas | null = null
	/** Bumped by every new pick or country; an answer for an older one is dropped. */
	private generation = 0

	public get nameErrorText(): FieldError | null {
		return fieldErrorOf(this.nameError)
	}

	public get areaErrorText(): FieldError | null {
		return fieldErrorOf(this.areaError)
	}

	public get zoneErrorText(): FieldError | null {
		return fieldErrorOf(this.zoneError)
	}

	/** The area's name in the member's language, for a Venue shown as text. */
	public get areaName(): string {
		return areaNameOf(this.country, this.area, this.language.current)
	}

	/** The zone's name, for a Venue or a one-zone country shown as text. */
	public get zoneName(): string {
		return zoneNameOf(this.country, this.zone, this.language.current)
	}

	/** A country with one zone shows it as text; several are a select. */
	public get singleZone(): boolean {
		return this.zones.length === 1
	}

	public binding(): void {
		void this.load()
	}

	public pickChanged(): void {
		void this.load()
	}

	/** 再試行: reads the place and its country again. */
	public retry(): void {
		void this.load()
	}

	public nameChanged(value: string): void {
		this.name = value
		this.publish()
	}

	/**
	 * Another country replaces the Areas and zones, clears the area, and
	 * selects the country's zone when it has only one.
	 */
	public async countryChanged(code: string): Promise<void> {
		this.countryCode = code
		this.area = ''
		this.zone = ''
		this.publish()
		const generation = ++this.generation
		try {
			await this.readCountry(code, generation)
		} catch (err) {
			if (generation !== this.generation) return
			this.logger.warn('Areas of the country could not be read', err)
			this.phase = 'unavailable'
			this.confirmation = null
			return
		}
		if (generation !== this.generation) return
		if (this.zones.length === 1) this.zone = this.zones[0].value
		this.publish()
	}

	/** An Area that lies wholly in one zone selects that zone. */
	public areaChanged(code: string): void {
		this.area = code
		const own = this.country ? areaZone(this.country, code) : ''
		if (own) this.zone = own
		this.publish()
	}

	public zoneChanged(zone: string): void {
		this.zone = zone
		this.publish()
	}

	private async load(): Promise<void> {
		const generation = ++this.generation
		const pick = this.pick
		if (!pick?.placeId) {
			this.phase = 'idle'
			this.confirmation = null
			return
		}
		// A date loaded from its concert, or one copied from the date before,
		// already carries its confirmation: show it without reading the place.
		const known =
			this.confirmation?.placeId === pick.placeId ? this.confirmation : null
		this.phase = 'loading'
		try {
			if (known) {
				await this.show(known, generation)
				return
			}
			const place = await this.venues.resolvePlace(pick.placeId)
			if (generation !== this.generation) return
			if (place.kind === 'venue') {
				await this.show(
					{
						placeId: pick.placeId,
						kind: 'venue',
						name: place.name,
						countryCode: place.adminArea.slice(0, 2),
						adminArea: place.adminArea,
						timeZone: place.timeZone,
					},
					generation,
				)
				return
			}
			this.kind = 'draft'
			this.name = place.name
			await this.readCountries(generation)
			await this.readCountry(place.countryCode, generation)
			if (generation !== this.generation) return
			this.countryCode = place.countryCode
			this.area = this.groups.some((g) =>
				g.areas.some((a) => a.value === place.suggestedAdminArea),
			)
				? place.suggestedAdminArea
				: ''
			const own = this.country ? areaZone(this.country, this.area) : ''
			this.zone =
				own ||
				(this.zones.some((z) => z.value === place.timeZone)
					? place.timeZone
					: this.zones.length === 1
						? this.zones[0].value
						: '')
			this.phase = 'ready'
			this.publish()
		} catch (err) {
			if (generation !== this.generation) return
			this.logger.warn('Picked place could not be read', err)
			this.phase = 'unavailable'
			this.confirmation = null
		}
	}

	/** Shows a known confirmation: a Venue as text, or a draft's inputs. */
	private async show(
		known: VenueConfirmation,
		generation: number,
	): Promise<void> {
		this.kind = known.kind
		this.name = known.name
		this.area = known.adminArea
		this.zone = known.timeZone
		this.countryCode = known.countryCode || known.adminArea.slice(0, 2)
		if (known.kind === 'draft') await this.readCountries(generation)
		if (this.countryCode) await this.readCountry(this.countryCode, generation)
		if (generation !== this.generation) return
		this.phase = 'ready'
		this.confirmation = known
	}

	private async readCountries(generation: number): Promise<void> {
		const countries = await this.venues.listCountries()
		if (generation !== this.generation) return
		this.countries = countryChoices(countries, this.language.current)
	}

	private async readCountry(code: string, generation: number): Promise<void> {
		const country = await this.venues.listByCountry(code)
		if (generation !== this.generation) return
		this.country = country
		// The editor's rows name the venue's zone as the API does.
		registerZoneNames(
			country.timeZones.map((z) => ({
				zone: z.timeZone?.value ?? '',
				nameJa: z.nameJa,
				nameEn: z.nameEn,
			})),
		)
		this.groups = areaGroups(country, this.language.current)
		this.zones = zoneChoices(
			country,
			this.language.current,
			new Date(this.clock.now()),
		)
	}

	private publish(): void {
		const placeId = this.pick?.placeId
		this.confirmation = placeId
			? {
					placeId,
					kind: this.kind,
					name: this.name.trim(),
					countryCode: this.countryCode,
					adminArea: this.area,
					timeZone: this.zone,
				}
			: null
	}
}
