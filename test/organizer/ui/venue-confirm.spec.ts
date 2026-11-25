import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	AreaSchema,
	CountrySchema,
	TimeZoneOptionSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/area_pb.js'
import { create } from '@bufbuild/protobuf'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IClock } from '../../../organizer/services/clock'
import {
	type CountryAreas,
	IVenueClient,
	type ResolvedPlace,
	type VenuePick,
} from '../../../organizer/services/venue-client'
import { ConsoleUi } from '../../../organizer/ui'
import type {
	VenueConfirm,
	VenueConfirmation,
} from '../../../organizer/ui/venue-confirm/venue-confirm'
import { controlNamed, deepAll, deepOne, deepText } from '../console-dom'

const SPEC = 'components/infrastructure/organizer/web/route/concert-editor'

/** 2027-01-15: Los Angeles is on standard time (UTC−8). */
const NOW = Date.UTC(2027, 0, 15, 3, 0)

function area(
	code: string,
	nameEn: string,
	nameJa: string,
	opts: { zone?: string; region?: string } = {},
) {
	return create(AreaSchema, {
		code: { value: code },
		countryCode: { value: code.slice(0, 2) },
		nameEn,
		nameJa,
		timeZone: opts.zone ? { value: opts.zone } : undefined,
		regionCodes: opts.region ? [{ value: opts.region }] : [],
	})
}

function zone(name: string, nameEn: string, nameJa: string) {
	return create(TimeZoneOptionSchema, {
		timeZone: { value: name },
		nameEn,
		nameJa,
	})
}

const COUNTRIES: Record<string, CountryAreas> = {
	JP: {
		areas: [
			area('JP-13', 'Tokyo', '東京都', {
				zone: 'Asia/Tokyo',
				region: 'JP-KANTO',
			}),
			area('JP-14', 'Kanagawa', '神奈川県', {
				zone: 'Asia/Tokyo',
				region: 'JP-KANTO',
			}),
			area('JP-27', 'Osaka', '大阪府', {
				zone: 'Asia/Tokyo',
				region: 'JP-KINKI',
			}),
		],
		regions: [
			area('JP-KANTO', 'Kanto', '関東'),
			area('JP-KINKI', 'Kinki', '近畿'),
		],
		timeZones: [zone('Asia/Tokyo', 'Japan', '日本')],
	},
	KR: {
		areas: [
			area('KR-11', 'Seoul', 'ソウル特別市', { zone: 'Asia/Seoul' }),
			area('KR-26', 'Busan', '釜山広域市', { zone: 'Asia/Seoul' }),
		],
		regions: [],
		timeZones: [zone('Asia/Seoul', 'Seoul', 'ソウル')],
	},
	US: {
		areas: [
			area('US-CA', 'California', 'カリフォルニア州', {
				zone: 'America/Los_Angeles',
			}),
			area('US-TX', 'Texas', 'テキサス州'),
		],
		regions: [],
		timeZones: [
			zone('America/Chicago', 'Chicago', 'シカゴ'),
			zone('America/Los_Angeles', 'Los Angeles', 'ロサンゼルス'),
		],
	},
}

const PICK: VenuePick = { placeId: 'ChIJ-pick', name: 'picked', address: '' }

function draft(
	over: Partial<Extract<ResolvedPlace, { kind: 'draft' }>> = {},
): ResolvedPlace {
	return {
		kind: 'draft',
		name: 'Zepp Haneda (TOKYO)',
		countryCode: 'JP',
		suggestedAdminArea: 'JP-13',
		timeZone: 'Asia/Tokyo',
		...over,
	}
}

async function mount(
	resolvePlace: () => Promise<ResolvedPlace>,
	place: VenueConfirmation | null = null,
) {
	const venues = {
		resolvePlace: vi.fn(resolvePlace),
		listCountries: vi.fn(async () => [
			create(CountrySchema, {
				code: { value: 'JP' },
				nameEn: 'Japan',
				nameJa: '日本',
			}),
			create(CountrySchema, {
				code: { value: 'KR' },
				nameEn: 'South Korea',
				nameJa: '韓国',
			}),
			create(CountrySchema, {
				code: { value: 'US' },
				nameEn: 'United States',
				nameJa: 'アメリカ合衆国',
			}),
		]),
		listByCountry: vi.fn(async (code: string) => COUNTRIES[code]),
		search: vi.fn(),
	}
	const host = {
		pick: PICK as VenuePick | null,
		place,
	}
	const fixture = createFixture(
		'<venue-confirm pick.bind="pick" confirmation.bind="place"></venue-confirm>',
		host,
		[
			ConsoleI18nConfiguration,
			...ConsoleFormatters,
			...ConsoleUi,
			Registration.instance(IVenueClient, venues),
			Registration.instance(IClock, { now: () => NOW }),
		],
	)
	await fixture.startPromise
	const el = fixture.appHost.querySelector('venue-confirm') as HTMLElement
	const vm = CustomElement.for<VenueConfirm>(el).viewModel
	await vi.waitFor(() => expect(vm.phase).not.toBe('loading'))
	await tasksSettled()
	return { fixture, el, vm, host, venues }
}

const select = (el: HTMLElement, label: string) => {
	const id = deepAll(el, 'label')
		.find((l) => l.textContent?.startsWith(label))
		?.getAttribute('for')
	return deepOne<HTMLSelectElement>(el, `select[id="${id}"]`)
}

const optionTexts = (s: HTMLSelectElement | null) =>
	Array.from(s?.options ?? []).map((o) => o.textContent?.trim())

describe('venue confirmation', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(`@spec ${SPEC} "Place in Japan prefilled"`, async () => {
		const m = await mount(async () => draft())

		const name = deepOne<HTMLInputElement>(m.el, 'input[type="text"]')
		expect(name?.value).toBe('Zepp Haneda (TOKYO)')
		expect(select(m.el, '国')?.value).toBe('JP')
		const areas = select(m.el, '地域')
		expect(areas?.value).toBe('JP-13')
		expect(
			Array.from(areas?.querySelectorAll('optgroup') ?? []).map((g) => g.label),
		).toEqual(['関東', '近畿'])
		expect(select(m.el, 'タイムゾーン')).toBeNull()
		expect(deepOne(m.el, '[data-role="zone-text"]')?.textContent).toBe('日本')
		expect(m.host.place).toEqual({
			placeId: 'ChIJ-pick',
			kind: 'draft',
			name: 'Zepp Haneda (TOKYO)',
			countryCode: 'JP',
			adminArea: 'JP-13',
			timeZone: 'Asia/Tokyo',
		})
	})

	it(`@spec ${SPEC} "Place abroad prefilled"`, async () => {
		const m = await mount(async () =>
			draft({
				name: 'Gocheok Sky Dome',
				countryCode: 'KR',
				suggestedAdminArea: 'KR-11',
				timeZone: 'Asia/Seoul',
			}),
		)

		expect(select(m.el, '国')?.value).toBe('KR')
		const areas = select(m.el, '地域')
		expect(areas?.value).toBe('KR-11')
		expect(areas?.selectedOptions[0]?.textContent?.trim()).toBe('ソウル特別市')
		expect(deepOne(m.el, '[data-role="zone-text"]')?.textContent).toBe('ソウル')
	})

	it(`@spec ${SPEC} "Country with several time zones"`, async () => {
		const m = await mount(async () =>
			draft({
				name: 'Hollywood Bowl',
				countryCode: 'US',
				suggestedAdminArea: 'US-CA',
				timeZone: 'America/Los_Angeles',
			}),
		)

		expect(select(m.el, '地域')?.selectedOptions[0]?.textContent?.trim()).toBe(
			'カリフォルニア州',
		)
		const zones = select(m.el, 'タイムゾーン')
		expect(zones?.value).toBe('America/Los_Angeles')
		expect(zones?.selectedOptions[0]?.textContent?.trim()).toBe(
			'ロサンゼルス (UTC−8)',
		)
		expect(optionTexts(zones)).toContain('シカゴ (UTC−6)')
	})

	it(`@spec ${SPEC} "Member renames the venue and changes the area"`, async () => {
		const m = await mount(async () => draft())

		m.vm.nameChanged('Zepp Haneda')
		m.vm.areaChanged('JP-14')

		expect(m.host.place).toEqual({
			placeId: 'ChIJ-pick',
			kind: 'draft',
			name: 'Zepp Haneda',
			countryCode: 'JP',
			adminArea: 'JP-14',
			timeZone: 'Asia/Tokyo',
		})
	})

	it(`@spec ${SPEC} "Member changes the country"`, async () => {
		const m = await mount(async () => draft())

		await m.vm.countryChanged('KR')
		await tasksSettled()

		const areas = select(m.el, '地域')
		expect(areas?.value).toBe('')
		expect(optionTexts(areas)).toContain('ソウル特別市')
		expect(optionTexts(areas)).not.toContain('東京都')
		expect(deepOne(m.el, '[data-role="zone-text"]')?.textContent).toBe('ソウル')
		expect(m.host.place?.adminArea).toBe('')
		expect(m.host.place?.timeZone).toBe('Asia/Seoul')
	})

	it(`@spec ${SPEC} "No suggested area"`, async () => {
		const m = await mount(async () => draft({ suggestedAdminArea: '' }))

		expect(select(m.el, '地域')?.value).toBe('')
		expect(m.host.place?.adminArea).toBe('')
		// The editor's save check turns the empty area into this field's error.
		m.vm.areaError = 'concertEditor.error.venueArea'
		await tasksSettled()
		expect(deepText(m.el)).toContain('地域を選択してください')
	})

	it(`@spec ${SPEC} "Several zones and none suggested"`, async () => {
		const m = await mount(async () =>
			draft({ countryCode: 'US', suggestedAdminArea: 'US-TX', timeZone: '' }),
		)

		expect(select(m.el, 'タイムゾーン')?.value).toBe('')
		expect(m.host.place?.timeZone).toBe('')
		m.vm.zoneError = 'concertEditor.error.venueTimeZone'
		await tasksSettled()
		expect(deepText(m.el)).toContain('タイムゾーンを選択してください')
	})

	it('selects the zone of an Area that lies wholly in one zone', async () => {
		const m = await mount(async () =>
			draft({ countryCode: 'US', suggestedAdminArea: 'US-TX', timeZone: '' }),
		)

		m.vm.areaChanged('US-CA')

		expect(m.host.place?.timeZone).toBe('America/Los_Angeles')
	})

	it('shows a copied draft whose area is not chosen yet in its own country', async () => {
		const m = await mount(async () => draft())
		await m.vm.countryChanged('US')
		const copied = m.host.place
		expect(copied).toMatchObject({ countryCode: 'US', adminArea: '' })

		// 公演日を追加 copies the confirmation into the next date's field.
		const next = await mount(async () => {
			throw new Error('a copied confirmation is not read again')
		}, copied)

		expect(next.vm.phase).toBe('ready')
		expect(select(next.el, '国')?.value).toBe('US')
		expect(optionTexts(select(next.el, '地域'))).toContain('テキサス州')
	})

	it(`@spec ${SPEC} "Place already a Venue"`, async () => {
		const m = await mount(async () => ({
			kind: 'venue',
			name: 'Zepp Namba (OSAKA)',
			adminArea: 'JP-27',
			timeZone: 'Asia/Tokyo',
		}))

		const text = deepText(m.el)
		expect(text).toContain('Zepp Namba (OSAKA)')
		expect(text).toContain('大阪府')
		expect(text).toContain('日本')
		expect(deepAll(m.el, 'input, select')).toHaveLength(0)
		expect(m.host.place?.kind).toBe('venue')
	})

	it(`@spec ${SPEC} "Place cannot be read"`, async () => {
		const m = await mount(async () => {
			throw new Error('unavailable')
		})

		expect(m.vm.phase).toBe('unavailable')
		expect(deepText(m.el)).toContain('会場を読み込めません。')
		expect(controlNamed(m.el, '再試行')).not.toBeNull()
		expect(m.host.place).toBeNull()

		m.venues.resolvePlace.mockImplementation(async () => draft())
		controlNamed(m.el, '再試行')?.click()
		await vi.waitFor(() => expect(m.vm.phase).toBe('ready'))
		expect(m.host.place?.adminArea).toBe('JP-13')
	})
})
