import {
	connectError,
	installConsole,
	type RpcLog,
	type RpcMocks,
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
 * The concert editor: venues picked from the map catalog, Japan-time dates,
 * save feedback, published dates kept fixed, the cover image preview, and
 * the unsaved-changes guard.
 */

const SPEC = 'components/infrastructure/organizer/web/route/concert-editor'
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
const venueSearch = (scope: Locator) => scope.getByRole('searchbox')
const snackbar = (page: Page) => page.locator('.snack-item')
const nav = (page: Page) =>
	page.getByRole('navigation', { name: 'メインナビゲーション' })
const calls = (log: RpcLog, method: string) =>
	log.calls.filter((c) => c.method === method)

async function pickVenue(scope: Locator, name = 'Zepp Haneda') {
	await venueSearch(scope).fill(name)
	await scope.getByRole('button', { name: '会場を検索' }).click()
	await scope.getByRole('radio', { name: /Zepp Haneda \(TOKYO\)/ }).click()
}

/** Title, performer and the first date of a new concert, all but the venue. */
async function fillNewConcert(page: Page, opts: { performer?: boolean } = {}) {
	await titleField(page).fill('XX 冬の単独公演')
	if (opts.performer ?? true)
		await page.getByRole('checkbox', { name: 'Band A' }).check()
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
		const log = await openEditor(page, '/concerts/new')
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
		await openEditor(page, '/concerts/new', {
			'VenueService/Search': { candidates: [] },
		})
		await venueSearch(row(page, 0)).fill('存在しない会場')
		await venueSearch(row(page, 0)).press('Enter')
		await expect(row(page, 0)).toContainText(
			'会場が見つかりませんでした。別の名前で検索してください。',
		)
		await expect(row(page, 0).getByRole('radio')).toHaveCount(0)
		await expect(
			row(page, 0).getByRole('button', { name: '変更' }),
		).toHaveCount(0)
		await expect(venueSearch(row(page, 0))).toBeVisible()
	})

	test(`@spec ${SPEC} "Search unavailable"`, async ({ page }) => {
		let attempts = 0
		const log = await openEditor(page, '/concerts/new', {
			'VenueService/Search': () => {
				attempts++
				return attempts === 1
					? connectError('unavailable', 'map catalog down', 503)
					: { body: { candidates: [HANEDA] } }
			},
		})
		await venueSearch(row(page, 0)).fill('Zepp Haneda')
		await row(page, 0).getByRole('button', { name: '会場を検索' }).click()
		await expect(row(page, 0)).toContainText('会場を検索できません。')
		await expect(
			row(page, 0).getByRole('button', { name: '変更' }),
		).toHaveCount(0)

		await row(page, 0).getByRole('button', { name: '再試行' }).click()
		await expect(
			row(page, 0).getByRole('radio', { name: /Zepp Haneda/ }),
		).toBeVisible()
		expect(calls(log, 'VenueService/Search')).toHaveLength(2)
	})

	test(`@spec ${SPEC} "Typed name not picked"`, async ({ page }) => {
		const log = await openEditor(page, '/concerts/new')
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
		const log = await openEditor(page, '/concerts/s-solo/edit', {
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
		const log = await openEditor(page, '/concerts/s-solo/edit', {
			'SeriesService/Update': oneSeries(XX_SOLO, {
				description: { value: '年末のワンマン' },
			}),
		})
		await page.getByLabel('説明').fill('年末のワンマン')
		await page.getByRole('button', { name: '保存する' }).click()

		await expect(snackbar(page)).toContainText('変更を保存しました')
		await expect(page).toHaveURL(/\/concerts\/s-solo\/edit$/)
		await expect(
			page.getByRole('heading', { level: 1, name: '公演を編集' }),
		).toBeVisible()
		await expect(page.getByLabel('説明')).toHaveValue('年末のワンマン')
		expect(calls(log, 'SeriesService/Update')).toHaveLength(1)
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
		const log = await openEditor(page, '/concerts/new', {
			'SeriesService/Create': oneSeries(created),
			'SeriesService/List': seriesList([TOUR, XX_SOLO, created]),
		})
		await fillNewConcert(page)
		await pickVenue(row(page, 0))
		await page.getByRole('button', { name: '公演をつくる' }).click()

		await expect(page).toHaveURL(/\/concerts\/s-new$/)
		await expect(snackbar(page)).toContainText('公演をつくりました')
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX 冬の単独公演' }),
		).toBeVisible()
		expect(calls(log, 'SeriesService/Create')).toHaveLength(1)
	})

	test(`@spec ${SPEC} "Missing performer"`, async ({ page }) => {
		const log = await openEditor(page, '/concerts/new')
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
		const log = await openEditor(page, '/concerts/new', {
			'SeriesService/Create': oneSeries(created),
			'SeriesService/List': seriesList([TOUR, XX_SOLO, created]),
		})
		const visibility = page.getByRole('group', { name: '公開範囲' })
		// A new concert starts as 公開, and each choice says what it does.
		await expect(visibility.getByRole('radio', { name: /^公開/ })).toBeChecked()
		await expect(visibility).toContainText('フォロワーへ通知します')
		await expect(visibility).toContainText(
			'共有リンクを知っている人だけが見られます',
		)

		await fillNewConcert(page)
		await pickVenue(row(page, 0))
		await visibility.getByRole('radio', { name: /^限定公開/ }).check()
		await page.getByRole('button', { name: '公演をつくる' }).click()

		await expect(page).toHaveURL(/\/concerts\/s-new$/)
		const [create] = calls(log, 'SeriesService/Create')
		expect(JSON.stringify(create.body)).toContain('VISIBILITY_UNLISTED')
	})

	test(`@spec ${SPEC} "Visibility fixed after publish"`, async ({ page }) => {
		await openEditor(page, '/concerts/s-tour/edit')
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
		const log = await openEditor(page, '/concerts/s-solo/edit', {
			'SeriesService/List': () => ({
				body: seriesList([saved ? timed : untimed]),
			}),
			'SeriesService/Update': () => {
				saved = true
				return { body: oneSeries(timed) }
			},
		})
		const start = row(page, 0).getByLabel('開演')
		await expect(start).toHaveValue('')
		await expect(row(page, 0)).toContainText('JST')
		await start.fill('18:00')
		await page.getByRole('button', { name: '保存する' }).click()
		await expect(snackbar(page)).toContainText('変更を保存しました')

		const body = calls(log, 'SeriesService/Update')[0]
			.body as unknown as DraftBody
		const sent = body.draft.events[0].startTime?.value ?? ''
		// 18:00 JST on 20 December is 09:00 UTC, whatever the device's zone.
		expect(new Date(sent).toISOString()).toBe(jst('2026-12-20', '18:00'))
		expect(sent).toMatch(/^2026-12-20T09:00:00(\.0+)?Z$/)

		await page.reload()
		await expect(row(page, 0).getByLabel('開演')).toHaveValue('18:00')
		await expect(row(page, 0).getByLabel('日付')).toHaveValue('2026-12-20')
	})
})

test.describe('a published concert', () => {
	test(`@spec ${SPEC} "Published event's venue is fixed"`, async ({ page }) => {
		await openEditor(page, '/concerts/s-tour/edit')
		const first = row(page, 0)
		await expect(first).toContainText('公開中')
		await expect(first).toContainText(
			'公開済みのため、会場と日付は変更できません',
		)
		await expect(first).toContainText('Zepp Haneda')
		await expect(venueSearch(first)).toHaveCount(0)
		await expect(first.getByRole('button', { name: '変更' })).toHaveCount(0)
		await expect(first.getByLabel('日付')).toBeDisabled()
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
		const log = await openEditor(page, '/concerts/s-tour/edit', {
			'SeriesService/Update': oneSeries(withNewDate),
		})
		await page.getByRole('button', { name: '公演日を追加' }).click()
		const added = row(page, 4)
		await expect(added).toContainText('下書き')
		await pickVenue(added)
		await added.getByLabel('日付').fill('2026-12-01')
		await added.getByLabel('開演').fill('18:00')
		await page.getByRole('button', { name: '保存する' }).click()

		await expect(snackbar(page)).toContainText('変更を保存しました')
		const body = calls(log, 'SeriesService/Update')[0]
			.body as unknown as DraftBody
		expect(body.draft.events).toHaveLength(5)
		expect(body.draft.events[4].eventId).toBeUndefined()
		expect(body.draft.events[4].placeId).toEqual({ value: 'ChIJ-haneda' })
		await expect(row(page, 4)).toContainText('下書き')
		await expect(
			row(page, 4).getByRole('button', { name: 'この公演日を削除' }),
		).toBeVisible()
		await expect(row(page, 0)).toContainText('公開中')
	})

	test(`@spec ${SPEC} "Start time already on sale"`, async ({ page }) => {
		const log = await openEditor(page, '/concerts/s-tour/edit', {
			'SeriesService/Update': () =>
				connectError('failed_precondition', 'tickets on sale', 400),
		})
		await row(page, 0).getByLabel('開演').fill('19:00')
		await page.getByRole('button', { name: '保存する' }).click()

		await expect(snackbar(page)).toContainText(
			'チケットの販売が始まった公演日の開始時刻は変更できないため、保存していません。',
		)
		await expect(
			snackbar(page).getByRole('button', { name: '再試行' }),
		).toHaveCount(0)
		expect(calls(log, 'SeriesService/Update')).toHaveLength(1)
		// Nothing was saved: the change is still unsaved in the editor.
		await expect(row(page, 0).getByLabel('開演')).toHaveValue('19:00')
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
		const log = await openEditor(page, '/concerts/s-solo/edit', UPLOAD_RPC)
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
		const log = await openEditor(page, '/concerts/s-solo/edit', {
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
		const log = await openEditor(page, '/concerts/s-solo/edit', {
			...UPLOAD_RPC,
			'SeriesService/List': listWith(XX_SOLO, cover('img-old', OLD_COVER)),
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

		await expect(preview(page)).toHaveAttribute('src', /^blob:/)
		await expect(page.getByText(PROCESSING)).toBeVisible()
	})
})

test.describe('unsaved changes', () => {
	test(`@spec ${FEEDBACK} "Leaving the editor with changes"`, async ({
		page,
	}) => {
		await openEditor(page, '/concerts/s-solo/edit')
		await titleField(page).fill('XX 単独公演 改')
		await nav(page).getByRole('link', { name: '公演' }).click()

		const dialog = page.getByRole('dialog', { name: '変更を破棄しますか？' })
		await expect(dialog).toBeVisible()
		await dialog.getByRole('button', { name: '編集を続ける' }).click()
		await expect(dialog).toBeHidden()
		await expect(page).toHaveURL(/\/concerts\/s-solo\/edit$/)
		await expect(titleField(page)).toHaveValue('XX 単独公演 改')
	})

	test(`@spec ${FEEDBACK} "Leaving after saving"`, async ({ page }) => {
		const renamed: ConcertSpec = { ...XX_SOLO, title: 'XX 単独公演 改' }
		await openEditor(page, '/concerts/s-solo/edit', {
			'SeriesService/Update': oneSeries(renamed),
		})
		await titleField(page).fill('XX 単独公演 改')
		await page.getByRole('button', { name: '保存する' }).click()
		await expect(snackbar(page)).toContainText('変更を保存しました')

		await nav(page).getByRole('link', { name: '公演' }).click()
		await expect(page).toHaveURL(/\/concerts$/)
		await expect(
			page.getByRole('heading', { level: 1, name: '公演' }),
		).toBeVisible()
		await expect(
			page.getByRole('dialog', { name: '変更を破棄しますか？' }),
		).toHaveCount(0)
	})
})
