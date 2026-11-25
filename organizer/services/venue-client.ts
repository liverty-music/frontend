import type {
	Area,
	Country,
	TimeZoneOption,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/area_pb.js'
import { AreaService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/area/v1/area_service_pb.js'
import { VenueService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/venue/v1/venue_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { IConsoleLanguage } from '../i18n/console-language'
import { createOrganizerTransport } from './organizer-transport'

/** A place picked from the map catalog. */
export interface VenuePick {
	placeId: string
	name: string
	/** The place's short address (the catalog's secondary text), or '' when unknown. */
	address: string
}

export type { Area, Country, TimeZoneOption }

/** What a picked place is: the Venue that holds it, or a draft to confirm. */
export type ResolvedPlace =
	| {
			kind: 'venue'
			name: string
			/** The Venue's first-level Area code; '' when it has none yet. */
			adminArea: string
			/** The Venue's IANA time zone; '' when it has none yet. */
			timeZone: string
	  }
	| {
			kind: 'draft'
			name: string
			countryCode: string
			/** The Area the place's address suggests; '' when none. */
			suggestedAdminArea: string
			/** The place's time zone as the server proposes it; '' when none. */
			timeZone: string
	  }

/** What a venue in one country is confirmed from. */
export interface CountryAreas {
	readonly areas: Area[]
	readonly regions: Area[]
	readonly timeZones: TimeZoneOption[]
}

export const IVenueClient = DI.createInterface<IVenueClient>(
	'IVenueClient',
	(x) => x.singleton(VenueClient),
)

export interface IVenueClient extends VenueClient {}

/**
 * Organizer-local wrapper around the generated `VenueService` and
 * `AreaService` clients: finds up to 5 places in the map catalog for the text
 * the member is typing, reads what a picked place will be, and lists the
 * countries, Areas and time zones a new venue is confirmed from. Errors
 * propagate to callers (the venue field shows Unavailable with 再試行); an
 * aborted request (`signal`, when the text changed) rejects too, and the venue
 * field drops it.
 */
export class VenueClient {
	private readonly logger = resolve(ILogger).scopeTo('VenueClient')
	private readonly client = createClient(
		VenueService,
		createOrganizerTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
			resolve(IConsoleLanguage),
		),
	)

	private readonly areaClient = createClient(
		AreaService,
		createOrganizerTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
			resolve(IConsoleLanguage),
		),
	)
	private countries: Promise<Country[]> | null = null
	private readonly areas = new Map<string, Promise<CountryAreas>>()

	/** Reads what a picked place will be (VenueService.ResolvePlace). */
	public async resolvePlace(placeId: string): Promise<ResolvedPlace> {
		try {
			const r = await this.client.resolvePlace({ placeId: { value: placeId } })
			if (r.result.case === 'venue') {
				const v = r.result.value
				return {
					kind: 'venue',
					name: v.name?.value ?? '',
					adminArea: v.adminArea?.value ?? '',
					timeZone: v.timeZone?.value ?? '',
				}
			}
			const d = r.result.value
			return {
				kind: 'draft',
				name: d?.name?.value ?? '',
				countryCode: d?.countryCode?.value ?? '',
				suggestedAdminArea: d?.suggestedAdminArea?.value ?? '',
				timeZone: d?.timeZone?.value ?? '',
			}
		} catch (err) {
			this.logger.warn('resolvePlace failed', { placeId, error: err })
			throw err
		}
	}

	/**
	 * The countries a venue can be in. Reference data: read once per page, and
	 * read again after a failure.
	 */
	public listCountries(): Promise<Country[]> {
		if (!this.countries) {
			const pending = this.areaClient.listCountries({}).then((r) => r.countries)
			pending.catch((err: unknown) => {
				this.countries = null
				this.logger.warn('listCountries failed', { error: err })
			})
			this.countries = pending
		}
		return this.countries
	}

	/** A country's first-level Areas, regions and time zones, read once per page. */
	public listByCountry(countryCode: string): Promise<CountryAreas> {
		let pending = this.areas.get(countryCode)
		if (!pending) {
			pending = this.areaClient
				.listByCountry({ countryCode: { value: countryCode } })
				.then((r) => ({
					areas: r.areas,
					regions: r.regions,
					timeZones: r.timeZones,
				}))
			pending.catch((err: unknown) => {
				this.areas.delete(countryCode)
				this.logger.warn('listByCountry failed', { countryCode, error: err })
			})
			this.areas.set(countryCode, pending)
		}
		return pending
	}

	public async search(
		text: string,
		signal?: AbortSignal,
	): Promise<VenuePick[]> {
		try {
			const response = await this.client.search({ text }, { signal })
			return response.candidates.map((c) => ({
				placeId: c.placeId?.value ?? '',
				name: c.name?.value ?? '',
				address: c.address,
			}))
		} catch (err) {
			// An aborted request is the caller's choice, not a failure.
			if (!signal?.aborted) this.logger.warn('search failed', { error: err })
			throw err
		}
	}
}
