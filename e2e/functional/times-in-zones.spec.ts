import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import {
	chooseTime,
	installConsole,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import { organizer, seriesList, XX_SOLO } from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'
import { wireDateTime, wireTime } from '../support/zoned-wire'

/**
 * Times in the zone they belong to, for shows in January 2027, in the real
 * browser: the fan's concert page with the browser set to Japan or London, and
 * a London show entered in the organizer console. The backend is mocked.
 */

const FAN = 'components/infrastructure/fan/web/global/i18n'
const EDITOR = 'components/infrastructure/organizer/web/route/concert-editor'

/** Before every show and sale of this file. */
const NOW = new Date('2026-12-01T12:00:00+09:00')

interface Show {
	id: string
	zone: string
	start: string
}

const show = (name: string, zone: string, start: string): Show => ({
	id: fakeId(`times-${name}`),
	zone,
	start,
})

const TAIPEI = show('taipei', 'Asia/Taipei', '19:00')
const SEOUL = show('seoul', 'Asia/Seoul', '18:30')
const TOKYO = show('tokyo', 'Asia/Tokyo', '18:30')

function concert({ id, zone, start }: Show) {
	return {
		id: { value: id },
		performers: [
			{ id: { value: fakeId('times-artist') }, name: { value: 'The Band' } },
		],
		series: {
			id: { value: fakeId('times-series') },
			title: { value: 'XX Tour 2027' },
			publishState: 'PUBLISH_STATE_PUBLISHED',
			organizerId: { value: fakeId('times-organizer') },
		},
		localDate: { value: { year: 2027, month: 1, day: 15 } },
		startTime: wireTime(start),
		venue: { name: { value: 'Hall' }, timeZone: { value: zone } },
	}
}

/** A first-come sale in Taipei time that opens on 1 January at 12:00 there. */
function taipeiSales(eventId: string) {
	return {
		ticketSales: [
			{
				id: { value: fakeId('times-sale') },
				name: { value: '一般発売' },
				method: 'TICKET_SALE_METHOD_FIRST_COME',
				saleStartTime: wireDateTime(
					{ year: 2027, month: 1, day: 1, hour: 12, minute: 0 },
					TAIPEI.zone,
				),
				saleEndTime: wireDateTime(
					{ year: 2027, month: 1, day: 15, hour: 12, minute: 0 },
					TAIPEI.zone,
				),
				eventIds: [{ value: eventId }],
			},
		],
	}
}

async function openConcert(page: Page, event: Show): Promise<void> {
	await page.clock.setFixedTime(NOW)
	await page.addInitScript(() => localStorage.setItem('language', 'ja'))
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()
		const json = (body: unknown) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(body),
			})
		if (url.includes('ConcertService/ListBySeries')) {
			return json(concertWire({ concerts: [concert(event)] }))
		}
		if (url.includes('ConcertService/Get')) {
			return json(concertWire({ concert: concert(event) }))
		}
		if (url.includes('TicketSaleService/ListByEvent')) {
			return json(event === TAIPEI ? taipeiSales(event.id) : {})
		}
		return json({})
	})
	await page.goto(`/concerts/${event.id}`)
	await expect(page.getByTestId('event-times')).toContainText(event.start, {
		timeout: 20_000,
	})
}

test.describe('a fan in Japan', () => {
	test.use({ timezoneId: 'Asia/Tokyo', locale: 'ja-JP' })

	test(`@spec ${FAN} "Event in Taipei seen from Japan"`, async ({ page }) => {
		await openConcert(page, TAIPEI)

		await expect(page.getByTestId('event-times')).toContainText('19:00')
		await expect(page.getByTestId('event-zone')).toHaveText(
			'台北時間（日本時間 20:00）',
		)
	})

	test(`@spec ${FAN} "Another zone with the same offset"`, async ({ page }) => {
		await openConcert(page, SEOUL)

		await expect(page.getByTestId('event-times')).toContainText('18:30')
		await expect(page.getByTestId('event-zone')).toHaveCount(0)
	})

	test(`@spec ${FAN} "Event and fan in Japan"`, async ({ page }) => {
		await openConcert(page, TOKYO)

		await expect(page.getByTestId('event-times')).toContainText('18:30')
		await expect(page.getByTestId('event-zone')).toHaveCount(0)
	})

	test(`@spec ${FAN} "Sale abroad seen from Japan"`, async ({ page }) => {
		await openConcert(page, TAIPEI)

		// 12:00 in Taipei is 13:00 in Japan.
		await expect(page.getByTestId('event-sale-opens')).toContainText(
			'1月1日(金) 13:00 日本時間',
		)
	})
})

test.describe('a fan in London', () => {
	test.use({ timezoneId: 'Europe/London', locale: 'ja-JP' })

	test(`@spec ${FAN} "Event in Japan seen from abroad"`, async ({ page }) => {
		await openConcert(page, TOKYO)

		await expect(page.getByTestId('event-times')).toContainText('18:30')
		await expect(page.getByTestId('event-zone')).toHaveText(
			'日本時間（ロンドン時間 09:30）',
		)
	})
})

test.describe('a member in Japan', () => {
	test.use({ timezoneId: 'Asia/Tokyo' })

	const LONDON_RPC: RpcMocks = {
		'SeriesService/List': seriesList([XX_SOLO]),
		'OrganizerService/Get': organizer(),
		'ArtistService/List': {
			artists: [{ id: { value: 'a-1' }, name: { value: 'Band A' } }],
		},
		'TicketSaleService/ListByEvent': { ticketSales: [] },
		'ScannerService/ListByEvent': { scanners: [] },
		'VenueService/Search': {
			candidates: [
				{
					placeId: { value: 'ChIJ-o2' },
					name: { value: 'The O2' },
					address: 'Peninsula Square, London',
				},
			],
		},
		'VenueService/ResolvePlace': {
			draft: {
				name: { value: 'The O2' },
				countryCode: { value: 'GB' },
				suggestedAdminArea: { value: 'GB-ENG' },
				timeZone: { value: 'Europe/London' },
			},
		},
		'AreaService/ListCountries': {
			countries: [
				{ code: { value: 'GB' }, nameEn: 'United Kingdom', nameJa: 'イギリス' },
			],
		},
		'AreaService/ListByCountry': {
			areas: [
				{
					code: { value: 'GB-ENG' },
					kind: 'AREA_KIND_SUBDIVISION',
					countryCode: { value: 'GB' },
					nameEn: 'England',
					nameJa: 'イングランド',
					timeZone: { value: 'Europe/London' },
				},
			],
			timeZones: [
				{
					timeZone: { value: 'Europe/London' },
					nameEn: 'London',
					nameJa: 'ロンドン',
				},
			],
		},
		'SeriesService/Create': { ...seriesList([XX_SOLO]), series: undefined },
	}

	test(`@spec ${EDITOR} "Japan time on another date"`, async ({ page }) => {
		await page.clock.setFixedTime(NOW)
		const log = await installConsole(page, {
			rpc: LONDON_RPC,
			language: 'ja',
		})
		await page.goto(`${SERIES}/new`)
		const row = page.locator('[data-row="0"]')
		await row.getByRole('combobox', { name: /^会場/ }).fill('The O2')
		await page.getByRole('option', { name: /The O2/ }).click()
		await expect(
			row.locator('venue-confirm [data-role="zone-text"]'),
		).toHaveText('ロンドン')
		await page.getByLabel('公演名').fill('XX London')
		await row.getByLabel('日付').fill('2027-01-15')
		await chooseTime(row, '開演', '19:00')

		await expect(row.getByTestId('row-zone')).toHaveText(
			'ロンドン時間（日本時間 1月16日(土) 04:00）',
		)

		await page.getByRole('button', { name: '公演をつくる' }).click()
		const created = () =>
			log.calls.filter((c) => c.method === 'SeriesService/Create')
		await expect.poll(() => created().length).toBe(1)
		const body = created()[0].body as {
			draft: { events: Array<{ startTime?: { value: unknown } }> }
		}
		// The wall-clock time at the venue; zero minutes are omitted.
		expect(body.draft.events[0].startTime?.value).toEqual({ hours: 19 })
	})
})
