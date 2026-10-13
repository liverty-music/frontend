import {
	brandColoredControls,
	chooseTime,
	connectError,
	installConsole,
	type RpcLog,
	type RpcMocks,
	SERIES,
	shownTime,
	timeField,
} from '../support/organizer'
import {
	type ConcertSpec,
	jst,
	organizer,
	seriesList,
	XX_SOLO,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Locator, type Page, test } from '../support/test'

/**
 * The concert editor: venues picked from the map catalog, Japan-time dates
 * and 24-hour times with the defaults of a new concert, save feedback and the return to the concert page, published dates kept
 * fixed, the cover image preview, and the unsaved-changes guard.
 */

const SPEC = 'components/infrastructure/organizer/web/route/concert-editor'
const TOKENS = 'components/infrastructure/organizer/web/global/design-tokens'
const FEEDBACK =
	'components/infrastructure/organizer/web/global/action-feedback'

/** Thursday 1 October 2026, 12:00 JST: every fixture date is in the future. */
const NOW = new Date('2026-10-01T12:00:00+09:00')

const ARTISTS = {
	artists: [{ id: { value: 'a-1' }, name: { value: 'Band A' } }],
}

const HANEDA = {
	placeId: { value: 'ChIJ-haneda' },
	name: { value: 'Zepp Haneda (TOKYO)' },
	address: '大田区羽田空港',
}

/** XX Tour 2026 with every date matched to a map place. */
const TOUR: ConcertSpec = {
	...XX_TOUR,
	events: XX_TOUR.events.map((e) => ({
		...e,
		placeId: e.placeId ?? `ChIJ-${e.id}`,
	})),
}

/** A SeriesService.Create / Update answer: one Series and its dates. */
function oneSeries(concert: ConcertSpec, extra: Record<string, unknown> = {}) {
	const list = seriesList([concert])
	return {
		...list,
		series: { ...(list.series as Array<Record<string, unknown>>)[0], ...extra },
	}
}

/**
 * A SeriesService.List answer that is `before` until SeriesService.Update has
 * been called, then `after`: the concert page the editor returns to reads the
 * saved concert.
 */
function listUpdatedBy(log: () => RpcLog, before: unknown, after: unknown) {
	return () => ({
		body: (calls(log(), 'SeriesService/Update').length
			? after
			: before) as Record<string, unknown>,
	})
}

/** A SeriesService.List answer whose Series carries extra fields (a cover). */
function listWith(concert: ConcertSpec, extra: Record<string, unknown>) {
	const list = seriesList([concert])
	return {
		...list,
		series: [
			{ ...(list.series as Array<Record<string, unknown>>)[0], ...extra },
		],
	}
}

const BASE: RpcMocks = {
	'SeriesService/List': seriesList([TOUR, XX_SOLO]),
	'OrganizerService/Get': organizer(),
	'ArtistService/List': ARTISTS,
	'VenueService/Search': { candidates: [HANEDA] },
	'TicketSaleService/ListByEvent': { ticketSales: [] },
	'ScannerService/ListByEvent': { scanners: [] },
}

async function openEditor(
	page: Page,
	path: string,
	rpc: RpcMocks = {},
): Promise<RpcLog> {
	await page.clock.setFixedTime(NOW)
	const log = await installConsole(page, {
		rpc: { ...BASE, ...rpc },
		language: 'ja',
	})
	await page.goto(path)
	await expect(
		page.getByRole('button', { name: /保存する|公演をつくる/ }),
	).toBeVisible()
	return log
}

const row = (page: Page, index: number) => page.locator(`[data-row="${index}"]`)
const titleField = (page: Page) => page.getByLabel('公演名')
const venueSearch = (scope: Locator) =>
	scope.getByRole('combobox', { name: /会場/ })
/** The venue field of a date row (its list of places, not the time selects). */
const venue = (scope: Locator) => scope.locator('venue-field')
const snackbar = (page: Page) => page.locator('.snack-item')
const nav = (page: Page) =>
	page.getByRole('navigation', { name: 'メインナビゲーション' })
const calls = (log: RpcLog, method: string) =>
	log.calls.filter((c) => c.method === method)

/** Types the name, waits for the field's search, and picks Zepp Haneda. */
async function pickVenue(scope: Locator, name = 'Zepp Haneda') {
	await venueSearch(scope).fill(name)
	await venue(scope)
		.getByRole('option', { name: /Zepp Haneda \(TOKYO\)/ })
		.click()
}

/** Longer than the venue field waits after the last keystroke (500 ms). */
const SEARCH_PAUSE_MS = 1000

/** Title, performer and the first date of a new concert, all but the venue. */
async function fillNewConcert(page: Page, opts: { performer?: boolean } = {}) {
	await titleField(page).fill('XX 冬の単独公演')
	// A new concert starts with the Artist it is created from (Band A) chosen.
	const band = page.getByRole('checkbox', { name: 'Band A' })
	await expect(band).toBeChecked()
	if (!(opts.performer ?? true)) await band.uncheck()
	await row(page, 0).getByLabel('日付').fill('2026-12-01')
}

interface DraftBody {
	draft: {
		title: { value: string }
		events: Array<{
			eventId?: { value: string }
			venueName: { value: string }
			placeId?: { value: string }
			startTime?: { value: string }
		}>
	}
}

test.describe('venue search', () => {
	test(`@spec ${SPEC} "Pick a venue"`, async ({ page }) => {
		const log = await openEditor(page, `${SERIES}/new`)
		await pickVenue(row(page, 0))

		await expect(row(page, 0)).toContainText('Zepp Haneda (TOKYO)')
		await expect(row(page, 0)).toContainText('大田区羽田空港')
		await expect(
			row(page, 0).getByRole('button', { name: '変更' }),
		).toBeVisible()
		expect(calls(log, 'VenueService/Search')[0]?.body).toEqual({
			text: 'Zepp Haneda',
		})

		// The picked place is what the new concert's date is saved with.
		await fillNewConcert(page)
		await page.getByRole('button', { name: '公演をつくる' }).click()
		await expect.poll(() => calls(log, 'SeriesService/Create').length).toBe(1)
		const body = calls(log, 'SeriesService/Create')[0]
			.body as unknown as DraftBody
		expect(body.draft.events[0].placeId).toEqual({ value: 'ChIJ-haneda' })
		expect(body.draft.events[0].venueName).toEqual({
			value: 'Zepp Haneda (TOKYO)',
		})
	})

	test(`@spec ${SPEC} "No match"`, async ({ page }) => {
		await openEditor(page, `${SERIES}/new`, {
			'VenueService/Search': { candidates: [] },
		})
		await venueSearch(row(page, 0)).fill('存在しない会場')
		await expect(row(page, 0)).toContainText(
			'会場が見つかりませんでした。別の名前で検索してください。',
		)
		await expect(venue(row(page, 0)).getByRole('option')).toHaveCount(0)
		await expect(
			row(page, 0).getByRole('button', { name: '変更' }),
		).toHaveCount(0)
		await expect(venueSearch(row(page, 0))).toBeVisible()
	})

	test(`@spec ${SPEC} "Search unavailable"`, async ({ page }) => {
		let attempts = 0
		const log = await openEditor(page, `${SERIES}/new`, {
			'VenueService/Search': () => {
				attempts++
				return attempts === 1
					? connectError('unavailable', 'map catalog down', 503)
					: { body: { candidates: [HANEDA] } }
			},
		})
		await venueSearch(row(page, 0)).fill('Zepp Haneda')
		await expect(row(page, 0)).toContainText('会場を検索できません。')
		await expect(
			row(page, 0).getByRole('button', { name: '変更' }),
		).toHaveCount(0)

		await row(page, 0).getByRole('button', { name: '再試行' }).click()
		await expect(
			venue(row(page, 0)).getByRole('option', { name: /Zepp Haneda/ }),
		).toBeVisible()
		expect(calls(log, 'VenueService/Search')).toHaveLength(2)
	})

	test(`@spec ${SPEC} "Short Japanese name"`, async ({ page }) => {
		const log = await openEditor(page, `${SERIES}/new`, {
			'VenueService/Search': {
				candidates: [
					{
						placeId: { value: 'ChIJ-budokan' },
						name: { value: '日本武道館' },
						address: '千代田区北の丸公園',
					},
				],
			},
		})
		await venueSearch(row(page, 0)).fill('武道館')
		await expect(
			venue(row(page, 0)).getByRole('option', { name: /日本武道館/ }),
		).toBeVisible()
		expect(calls(log, 'VenueService/Search').map((c) => c.body)).toEqual([
			{ text: '武道館' },
		])
	})

	test(`@spec ${SPEC} "Short Latin text"`, async ({ page }) => {
		const log = await openEditor(page, `${SERIES}/new`)
		await venueSearch(row(page, 0)).fill('Zepp')
		await page.waitForTimeout(SEARCH_PAUSE_MS)
		expect(calls(log, 'VenueService/Search')).toHaveLength(0)
		await expect(venueSearch(row(page, 0))).toHaveAttribute(
			'aria-expanded',
			'false',
		)

		await venueSearch(row(page, 0)).fill('Zepp H')
		await expect(
			venue(row(page, 0)).getByRole('option', { name: /Zepp Haneda/ }),
		).toBeVisible()
		expect(calls(log, 'VenueService/Search').map((c) => c.body)).toEqual([
			{ text: 'Zepp H' },
		])
	})

	test(`@spec ${SPEC} "Typing on"`, async ({ page }) => {
		let releaseFirst: () => void = () => {}
		const firstHeld = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		const log = await openEditor(page, `${SERIES}/new`, {
			'VenueService/Search': async (request) => {
				if (request.text === 'LIQUID') {
					// The answer for LIQUID arrives after the one for LIQUIDROOM.
					await firstHeld
					return { body: { candidates: [HANEDA] } }
				}
				return {
					body: {
						candidates: [
							{
								placeId: { value: 'ChIJ-liquidroom' },
								name: { value: 'LIQUIDROOM' },
								address: '渋谷区東',
							},
						],
					},
				}
			},
		})
		const field = row(page, 0)
		await venueSearch(field).fill('LIQUID')
		await expect.poll(() => calls(log, 'VenueService/Search').length).toBe(1)
		await venueSearch(field).fill('LIQUIDROOM')
		await expect(
			venue(field).getByRole('option', { name: /LIQUIDROOM/ }),
		).toBeVisible()

		releaseFirst()
		await page.waitForTimeout(SEARCH_PAUSE_MS)
		await expect(venue(field).getByRole('option')).toHaveCount(1)
		await expect(
			venue(field).getByRole('option', { name: /Zepp Haneda/ }),
		).toHaveCount(0)
		expect(calls(log, 'VenueService/Search').map((c) => c.body)).toEqual([
			{ text: 'LIQUID' },
			{ text: 'LIQUIDROOM' },
		])
	})

	test(`@spec ${SPEC} "Keyboard pick"`, async ({ page }) => {
		await openEditor(page, `${SERIES}/new`, {
			'VenueService/Search': {
				candidates: [
					HANEDA,
					{
						placeId: { value: 'ChIJ-divercity' },
						name: { value: 'Zepp DiverCity (TOKYO)' },
						address: '江東区青海',
					},
				],
			},
		})
		const field = row(page, 0)
		await venueSearch(field).fill('Zepp Haneda')
		await expect(venue(field).getByRole('option')).toHaveCount(2)
		// The list credits Google Maps as its source.
		await expect(field.getByText('Google Maps')).toBeVisible()

		await venueSearch(field).press('ArrowDown')
		await venueSearch(field).press('ArrowDown')
		await venueSearch(field).press('Enter')

		await expect(field).toContainText('Zepp DiverCity (TOKYO)')
		await expect(field).toContainText('江東区青海')
		await expect(venue(field).getByRole('option')).toHaveCount(0)
		await expect(field.getByRole('button', { name: '変更' })).toBeVisible()
	})

	test(`@spec ${SPEC} "Typed name not picked"`, async ({ page }) => {
		const log = await openEditor(page, `${SERIES}/new`)
		await fillNewConcert(page)
		await venueSearch(row(page, 0)).fill('Zepp Haneda')
		await page.getByRole('button', { name: '公演をつくる' }).click()

		await expect(row(page, 0)).toContainText('検索結果から会場を選んでください')
		await expect(venueSearch(row(page, 0))).toBeFocused()
		expect(calls(log, 'SeriesService/Create')).toHaveLength(0)
	})
})

test.describe('saving', () => {
	test(`@spec ${SPEC} "Title change only"`, async ({ page }) => {
		const renamed: ConcertSpec = { ...XX_SOLO, title: 'XX 単独公演 2026' }
		const log = await openEditor(page, `${SERIES}/s-solo/edit`, {
			'SeriesService/Update': oneSeries(renamed),
		})
		await titleField(page).fill('XX 単独公演 2026')
		await page.getByRole('button', { name: '保存する' }).click()
		await expect(snackbar(page)).toContainText('変更を保存しました')

		const body = calls(log, 'SeriesService/Update')[0]
			.body as unknown as DraftBody
		expect(body.draft.title).toEqual({ value: 'XX 単独公演 2026' })
		expect(body.draft.events).toHaveLength(1)
		expect(body.draft.events[0].eventId).toEqual({ value: 'e-1220' })
		expect(body.draft.events[0].placeId).toEqual({ value: 'ChIJ-haneda' })
		expect(body.draft.events[0].venueName).toEqual({ value: 'Zepp Haneda' })
	})

	test(`@spec ${SPEC} "Saved"`, async ({ page }) => {
		const renamed: ConcertSpec = { ...XX_SOLO, title: 'XX 年末ワンマン' }
		let log: RpcLog = { calls: [] }
		log = await openEditor(page, `${SERIES}/s-solo/edit`, {
			'SeriesService/Update': oneSeries(renamed, {
				description: { value: '年末のワンマン' },
			}),
			'SeriesService/List': listUpdatedBy(
				() => log,
				seriesList([TOUR, XX_SOLO]),
				seriesList([TOUR, renamed]),
			),
		})
		await titleField(page).fill('XX 年末ワンマン')
		await page.getByLabel('説明').fill('年末のワンマン')
		await page.getByRole('button', { name: '保存する' }).click()

		// The concert page the editor was opened for, with the saved values.
		await expect(page).toHaveURL(/\/series\/s-solo$/)
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX 年末ワンマン' }),
		).toBeVisible()
		await expect(snackbar(page)).toContainText('変更を保存しました')
		const updates = calls(log, 'SeriesService/Update')
		expect(updates).toHaveLength(1)
		expect(
			(updates[0].body as { draft: { description: { value: string } } }).draft
				.description,
		).toEqual({ value: '年末のワンマン' })
	})

	// Requirement "Save gives feedback and returns to where the editor was
	// opened": leaving without saving is offered as キャンセル.
	test('キャンセル returns to the concert page without saving', async ({
		page,
	}) => {
		const log = await openEditor(page, `${SERIES}/s-solo/edit`)
		const bar = page.locator('action-bar')
		await expect(bar.getByRole('link', { name: 'キャンセル' })).toBeVisible()
		await bar.getByRole('link', { name: 'キャンセル' }).click()
		await expect(page).toHaveURL(/\/series\/s-solo$/)
		expect(calls(log, 'SeriesService/Update')).toHaveLength(0)
	})

	// The editor's キャンセル, 公演日を追加 and 変更 are text buttons: they are
	// neutral, so the brand color stays on 保存する alone.
	test(`@spec ${TOKENS} "One primary action"`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' })
		await openEditor(page, `${SERIES}/s-solo/edit`)
		const bar = page.locator('action-bar')
		await expect(bar.getByRole('link', { name: 'キャンセル' })).toBeVisible()
		await expect(
			page.getByRole('button', { name: '公演日を追加' }),
		).toBeVisible()
		expect(await brandColoredControls(page)).toEqual(['保存する'])

		// The console follows the system into dark without a reload.
		const background = () =>
			page.evaluate(() => getComputedStyle(document.body).backgroundColor)
		const light = await background()
		await page.emulateMedia({ colorScheme: 'dark' })
		await expect.poll(background).not.toBe(light)
		expect(await brandColoredControls(page)).toEqual(['保存する'])
	})

	test(`@spec ${SPEC} "New concert"`, async ({ page }) => {
		const created: ConcertSpec = {
			id: 's-new',
			title: 'XX 冬の単独公演',
			performers: [{ id: 'a-1', name: 'Band A' }],
			events: [
				{
					id: 'e-1201',
					date: '2026-12-01',
					venue: 'Zepp Haneda (TOKYO)',
					placeId: 'ChIJ-haneda',
				},
			],
		}
		const log = await openEditor(page, `${SERIES}/new`, {
			'SeriesService/Create': oneSeries(created),
			'SeriesService/List': seriesList([TOUR, XX_SOLO, created]),
		})
		await fillNewConcert(page)
		await pickVenue(row(page, 0))
		await page.getByRole('button', { name: '公演をつくる' }).click()

		await expect(page).toHaveURL(/\/series\/s-new$/)
		await expect(snackbar(page)).toContainText('公演をつくりました')
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX 冬の単独公演' }),
		).toBeVisible()
		expect(calls(log, 'SeriesService/Create')).toHaveLength(1)
	})

	test(`@spec ${SPEC} "Missing performer"`, async ({ page }) => {
		const log = await openEditor(page, `${SERIES}/new`)
		await fillNewConcert(page, { performer: false })
		await pickVenue(row(page, 0))
		await page.getByRole('button', { name: '公演をつくる' }).click()

		const performers = page.getByRole('group', { name: /出演者/ })
		await expect(performers).toContainText('出演者を1組以上選んでください')
		await expect(page.getByRole('checkbox', { name: 'Band A' })).toBeFocused()
		expect(calls(log, 'SeriesService/Create')).toHaveLength(0)
	})
})

test.describe('visibility', () => {
	test(`@spec ${SPEC} "Unlisted concert created"`, async ({ page }) => {
		const created: ConcertSpec = {
			id: 's-new',
			title: 'XX 冬の単独公演',
			visibility: 'UNLISTED',
			performers: [{ id: 'a-1', name: 'Band A' }],
			events: [
				{
					id: 'e-1201',
					date: '2026-12-01',
					venue: 'Zepp Haneda (TOKYO)',
					placeId: 'ChIJ-haneda',
				},
			],
		}
		const log = await openEditor(page, `${SERIES}/new`, {
			'SeriesService/Create': oneSeries(created),
			'SeriesService/List': seriesList([TOUR, XX_SOLO, created]),
		})
		const visibility = page.getByRole('group', { name: '公開範囲' })
		// A new concert starts as 公開, and each choice says what it does.
		await expect(visibility.getByRole('radio', { name: /^公開/ })).toBeChecked()
		await expect(visibility).toContainText('フォロワーへ通知します')
		await expect(visibility).toContainText(
			'ファン向けの一覧に表示しません。公開してもフォロワーには通知しません。',
		)
		// No share link is promised: UNLISTED concerts have no fan entry yet (D21).
		await expect(visibility).not.toContainText('共有リンク')

		await fillNewConcert(page)
		await pickVenue(row(page, 0))
		await visibility.getByRole('radio', { name: /^限定公開/ }).check()
		await page.getByRole('button', { name: '公演をつくる' }).click()

		await expect(page).toHaveURL(/\/series\/s-new$/)
		const [create] = calls(log, 'SeriesService/Create')
		expect(JSON.stringify(create.body)).toContain('VISIBILITY_UNLISTED')
	})

	test(`@spec ${SPEC} "Visibility fixed after publish"`, async ({ page }) => {
		await openEditor(page, `${SERIES}/s-tour/edit`)
		const visibility = page.getByRole('group', { name: '公開範囲' })
		await expect(visibility.getByRole('radio', { name: /^公開/ })).toBeChecked()
		await expect(
			visibility.getByRole('radio', { name: /^公開/ }),
		).toBeDisabled()
		await expect(
			visibility.getByRole('radio', { name: /^限定公開/ }),
		).toBeDisabled()
		await expect(visibility).toContainText('公開範囲は変更できません')
	})
})

test.describe('times in another time zone', () => {
	test.use({ timezoneId: 'Europe/London' })

	test(`@spec ${SPEC} "Device in another time zone"`, async ({ page }) => {
		const untimed: ConcertSpec = {
			...XX_SOLO,
			events: [{ ...XX_SOLO.events[0], start: undefined }],
		}
		const timed: ConcertSpec = XX_SOLO
		let saved = false
		const log = await openEditor(page, `${SERIES}/s-solo/edit`, {
			'SeriesService/List': () => ({
				body: seriesList([saved ? timed : untimed]),
			}),
			'SeriesService/Update': () => {
				saved = true
				return { body: oneSeries(timed) }
			},
		})
		const start = timeField(row(page, 0), '開演')
		expect(await shownTime(row(page, 0), '開演')).toBe('')
		await expect(start).toContainText('JST')
		await chooseTime(row(page, 0), '開演', '18:00')
		await page.getByRole('button', { name: '保存する' }).click()
		await expect(snackbar(page)).toContainText('変更を保存しました')

		const body = calls(log, 'SeriesService/Update')[0]
			.body as unknown as DraftBody
		const sent = body.draft.events[0].startTime?.value ?? ''
		// 18:00 JST on 20 December is 09:00 UTC, whatever the device's zone.
		expect(new Date(sent).toISOString()).toBe(jst('2026-12-20', '18:00'))
		expect(sent).toMatch(/^2026-12-20T09:00:00(\.0+)?Z$/)

		// Saving returns to the concert page; reopen the editor.
		await expect(page).toHaveURL(/\/series\/s-solo$/)
		await page.goto(`${SERIES}/s-solo/edit`)
		await expect.poll(() => shownTime(row(page, 0), '開演')).toBe('18:00')
		await expect(row(page, 0).getByLabel('日付')).toHaveValue('2026-12-20')
	})
})

test.describe('times on a 12-hour device', () => {
	// An English (United States) device writes 18:00 as 6:00 PM.
	test.use({ locale: 'en-US' })

	test(`@spec ${SPEC} "Device using a 12-hour clock"`, async ({ page }) => {
		await openEditor(page, `${SERIES}/s-solo/edit`)
		expect(
			await page.evaluate(() =>
				new Date(2026, 11, 20, 18).toLocaleTimeString(undefined, {
					hour: 'numeric',
					minute: '2-digit',
				}),
			),
		).toMatch(/PM/)

		for (const label of ['開場', '開演']) {
			const hours = timeField(row(page, 0), label).getByRole('combobox', {
				name: '時',
			})
			const texts = (await hours.locator('option').allTextContents()).map((t) =>
				t.trim(),
			)
			expect(texts.filter((t) => t !== '--')).toEqual(
				Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
			)
		}
		expect(await shownTime(row(page, 0), '開演')).toBe('18:00')
		await expect(row(page, 0)).not.toContainText(/AM|PM|午前|午後/)
	})
})

test.describe('dates and times of a new concert', () => {
	test(`@spec ${SPEC} "Defaults of a new concert"`, async ({ page }) => {
		await openEditor(page, `${SERIES}/new`)
		await expect.poll(() => shownTime(row(page, 0), '開場')).toBe('17:00')
		expect(await shownTime(row(page, 0), '開演')).toBe('19:00')
		await expect(timeField(row(page, 0), '開演')).toContainText('JST')
	})

	test(`@spec ${SPEC} "Another night at the same venue"`, async ({ page }) => {
		const log = await openEditor(page, `${SERIES}/new`, {
			'SeriesService/Create': oneSeries(XX_SOLO),
		})
		await fillNewConcert(page)
		await pickVenue(row(page, 0))
		await row(page, 0).getByLabel('日付').fill('2026-11-03')
		await chooseTime(row(page, 0), '開演', '18:00')

		await page.getByRole('button', { name: '公演日を追加' }).click()
		const added = row(page, 1)
		await expect(added).toContainText('Zepp Haneda (TOKYO)')
		await expect(added).toContainText('大田区羽田空港')
		await expect(added.getByLabel('日付')).toHaveValue('2026-11-03')
		expect(await shownTime(added, '開場')).toBe('17:00')
		expect(await shownTime(added, '開演')).toBe('18:00')

		// Only the date changes for the next night.
		await added.getByLabel('日付').fill('2026-11-04')
		await page.getByRole('button', { name: '公演をつくる' }).click()
		await expect.poll(() => calls(log, 'SeriesService/Create').length).toBe(1)
		const body = calls(log, 'SeriesService/Create')[0]
			.body as unknown as DraftBody
		expect(body.draft.events).toHaveLength(2)
		for (const [i, day] of [
			[0, '2026-11-03'],
			[1, '2026-11-04'],
		] as const) {
			expect(body.draft.events[i].placeId).toEqual({ value: 'ChIJ-haneda' })
			expect(
				new Date(body.draft.events[i].startTime?.value ?? '').toISOString(),
			).toBe(jst(day, '18:00'))
		}
	})
})

test.describe('a published concert', () => {
	test(`@spec ${SPEC} "Published event's venue is fixed"`, async ({ page }) => {
		await openEditor(page, `${SERIES}/s-tour/edit`)
		const first = row(page, 0)
		await expect(first).toContainText('公開中')
		await expect(first).toContainText(
			'公開済みのため、会場と日付は変更できません',
		)
		await expect(first).toContainText('Zepp Haneda')
		await expect(venueSearch(first)).toHaveCount(0)
		await expect(first.getByRole('button', { name: '変更' })).toHaveCount(0)
		await expect(first.getByLabel('日付')).not.toBeEditable()
		await expect(
			page.getByRole('button', { name: 'この公演日を削除' }),
		).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Additional date saved as a draft"`, async ({ page }) => {
		const withNewDate: ConcertSpec = {
			...TOUR,
			events: [
				...TOUR.events,
				{
					id: 'e-1201',
					date: '2026-12-01',
					start: '18:00',
					venue: 'Zepp Haneda (TOKYO)',
					placeId: 'ChIJ-haneda',
					state: 'DRAFT',
				},
			],
		}
		let log: RpcLog = { calls: [] }
		log = await openEditor(page, `${SERIES}/s-tour/edit`, {
			'SeriesService/Update': oneSeries(withNewDate),
			'SeriesService/List': listUpdatedBy(
				() => log,
				seriesList([TOUR, XX_SOLO]),
				seriesList([withNewDate, XX_SOLO]),
			),
		})
		await page.getByRole('button', { name: '公演日を追加' }).click()
		const added = row(page, 4)
		await expect(added).toContainText('下書き')
		// The new date starts as a copy of the last one (Zepp Fukuoka).
		await expect(added).toContainText('Zepp Fukuoka')
		await added.getByRole('button', { name: '変更' }).click()
		await pickVenue(added)
		await added.getByLabel('日付').fill('2026-12-01')
		await chooseTime(added, '開演', '18:00')
		await page.getByRole('button', { name: '保存する' }).click()

		await expect(snackbar(page)).toContainText('変更を保存しました')
		const body = calls(log, 'SeriesService/Update')[0]
			.body as unknown as DraftBody
		expect(body.draft.events).toHaveLength(5)
		expect(body.draft.events[4].eventId).toBeUndefined()
		expect(body.draft.events[4].placeId).toEqual({ value: 'ChIJ-haneda' })
		// The concert page shows the new date as a draft.
		await expect(page).toHaveURL(/\/series\/s-tour$/)
		await expect(page.locator('concert-route')).toContainText('下書き')
	})

	test(`@spec ${SPEC} "Start time already on sale"`, async ({ page }) => {
		const log = await openEditor(page, `${SERIES}/s-tour/edit`, {
			'SeriesService/Update': () =>
				connectError('failed_precondition', 'tickets on sale', 400),
		})
		await chooseTime(row(page, 0), '開演', '19:00')
		await page.getByRole('button', { name: '保存する' }).click()

		await expect(snackbar(page)).toContainText(
			'チケットの販売が始まった公演日の開始時刻は変更できないため、保存していません。',
		)
		await expect(
			snackbar(page).getByRole('button', { name: '再試行' }),
		).toHaveCount(0)
		expect(calls(log, 'SeriesService/Update')).toHaveLength(1)
		// Nothing was saved: the change is still unsaved in the editor.
		expect(await shownTime(row(page, 0), '開演')).toBe('19:00')
		await nav(page).getByRole('link', { name: '公演' }).click()
		await expect(
			page.getByRole('dialog', { name: '変更を破棄しますか？' }),
		).toBeVisible()
	})
})

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
)
const UPLOAD_URL =
	'https://storage.googleapis.com/e2e-bucket/series-images/img-new'
const NEW_COVER =
	'https://cdn.liverty-music.app/series-images/img-new/large.webp'
const OLD_COVER =
	'https://cdn.liverty-music.app/series-images/img-old/large.webp'

function cover(id: string, url: string) {
	return {
		coverImage: {
			id: { value: id },
			large: { value: url },
			thumb: { value: url },
		},
	}
}

/** Mocks the signed upload and the served images; returns the uploaded bodies. */
async function mockImageHosts(page: Page): Promise<string[]> {
	const puts: string[] = []
	await page.route('https://storage.googleapis.com/**', (route) => {
		puts.push(route.request().method())
		return route.fulfill({
			status: 200,
			headers: { 'access-control-allow-origin': '*' },
			body: '',
		})
	})
	await page.route('https://cdn.liverty-music.app/**', (route) =>
		route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
	)
	return puts
}

const UPLOAD_RPC: RpcMocks = {
	'SeriesImageService/CreateUploadUrl': {
		uploadUrl: { value: UPLOAD_URL },
		seriesImageId: { value: 'img-new' },
		maxBytes: '10485760',
	},
	'SeriesService/SetCoverImage': {},
}

async function pickCover(page: Page) {
	await page.getByLabel(/画像を選ぶ/).setInputFiles({
		name: 'cover.png',
		mimeType: 'image/png',
		buffer: PNG,
	})
}

const preview = (page: Page) => page.getByTestId('cover-preview')
const PROCESSING =
	'選んだ画像を表示しています。最適化した画像の準備ができると切り替わります。'

test.describe('cover image', () => {
	test(`@spec ${SPEC} "Image just uploaded"`, async ({ page }) => {
		const puts = await mockImageHosts(page)
		const log = await openEditor(page, `${SERIES}/s-solo/edit`, UPLOAD_RPC)
		await pickCover(page)

		await expect(preview(page)).toHaveAttribute('src', /^blob:/)
		await expect(
			page.getByRole('status').filter({ hasText: PROCESSING }),
		).toBeVisible()
		expect(puts).toEqual(['PUT'])
		expect(calls(log, 'SeriesImageService/CreateUploadUrl')[0].body).toEqual({
			contentType: 'image/png',
		})
		expect(calls(log, 'SeriesService/SetCoverImage')[0].body).toEqual({
			seriesId: { value: 's-solo' },
			seriesImageId: { value: 'img-new' },
		})
	})

	test(`@spec ${SPEC} "Processed image available"`, async ({ page }) => {
		await mockImageHosts(page)
		let coverSet = false
		let listsAfterSet = 0
		const log = await openEditor(page, `${SERIES}/s-solo/edit`, {
			...UPLOAD_RPC,
			'SeriesService/SetCoverImage': () => {
				coverSet = true
				return { body: {} }
			},
			// The first check after the cover is set still sees no processed
			// image; the next one sees it.
			'SeriesService/List': () => {
				if (coverSet) listsAfterSet++
				return {
					body:
						listsAfterSet >= 2
							? listWith(XX_SOLO, cover('img-new', NEW_COVER))
							: seriesList([XX_SOLO]),
				}
			},
		})
		await pickCover(page)
		await expect(preview(page)).toHaveAttribute('src', /^blob:/)
		await expect(page.getByText(PROCESSING)).toBeVisible()

		// The editor re-reads the concert every 3 s until the cover is processed.
		await expect(preview(page)).toHaveAttribute('src', NEW_COVER, {
			timeout: 12_000,
		})
		await expect(page.getByText(PROCESSING)).toHaveCount(0)
		expect(listsAfterSet).toBe(2)
		expect(calls(log, 'SeriesService/List').length).toBe(3)
	})

	test(`@spec ${SPEC} "Saved before processing finished"`, async ({ page }) => {
		await mockImageHosts(page)
		let log: RpcLog = { calls: [] }
		// The new cover is processed only after the concert page has read the
		// concert twice following the save.
		const listsAfterSave = () => {
			const saved = log.calls.findIndex(
				(c) => c.method === 'SeriesService/Update',
			)
			return saved < 0
				? 0
				: log.calls
						.slice(saved)
						.filter((c) => c.method === 'SeriesService/List').length
		}
		log = await openEditor(page, `${SERIES}/s-solo/edit`, {
			...UPLOAD_RPC,
			'SeriesService/List': () => ({
				body:
					listsAfterSave() >= 3
						? listWith(XX_SOLO, cover('img-new', NEW_COVER))
						: listWith(XX_SOLO, cover('img-old', OLD_COVER)),
			}),
			'SeriesService/Update': oneSeries(XX_SOLO, {
				...cover('img-old', OLD_COVER),
				description: { value: '年末のワンマン' },
			}),
		})
		await expect(preview(page)).toHaveAttribute('src', OLD_COVER)
		await pickCover(page)
		await expect(preview(page)).toHaveAttribute('src', /^blob:/)

		await page.getByLabel('説明').fill('年末のワンマン')
		await page.getByRole('button', { name: '保存する' }).click()
		await expect(snackbar(page)).toContainText('変更を保存しました')
		expect(calls(log, 'SeriesService/Update')).toHaveLength(1)

		// The concert page shows the picked image and the note, not the
		// previous cover, though the Series still serves the previous one.
		await expect(page).toHaveURL(/\/series\/s-solo$/)
		const concertCover = page.getByTestId('concert-cover')
		await expect(concertCover).toHaveAttribute('src', /^blob:/)
		await expect(
			page.getByRole('status').filter({ hasText: PROCESSING }),
		).toBeVisible()

		// It re-reads every 3 s and shows the processed image once served.
		await expect(concertCover).toHaveAttribute('src', NEW_COVER, {
			timeout: 15_000,
		})
		await expect(page.getByText(PROCESSING)).toHaveCount(0)
	})
})

test.describe('unsaved changes', () => {
	test(`@spec ${FEEDBACK} "Leaving the editor with changes"`, async ({
		page,
	}) => {
		await openEditor(page, `${SERIES}/s-solo/edit`)
		await titleField(page).fill('XX 単独公演 改')
		await nav(page).getByRole('link', { name: '公演' }).click()

		const dialog = page.getByRole('dialog', { name: '変更を破棄しますか？' })
		await expect(dialog).toBeVisible()
		await dialog.getByRole('button', { name: '編集を続ける' }).click()
		await expect(dialog).toBeHidden()
		await expect(page).toHaveURL(/\/series\/s-solo\/edit$/)
		await expect(titleField(page)).toHaveValue('XX 単独公演 改')
	})

	test(`@spec ${FEEDBACK} "Leaving after saving"`, async ({ page }) => {
		const renamed: ConcertSpec = { ...XX_SOLO, title: 'XX 単独公演 改' }
		await openEditor(page, `${SERIES}/s-solo/edit`, {
			'SeriesService/Update': oneSeries(renamed),
		})
		await titleField(page).fill('XX 単独公演 改')
		await page.getByRole('button', { name: '保存する' }).click()
		await expect(snackbar(page)).toContainText('変更を保存しました')

		await nav(page).getByRole('link', { name: '公演' }).click()
		await expect(page).toHaveURL(/\/series$/)
		await expect(
			page.getByRole('heading', { level: 1, name: '公演' }),
		).toBeVisible()
		await expect(
			page.getByRole('dialog', { name: '変更を破棄しますか？' }),
		).toHaveCount(0)
	})
})
