import {
	brandColoredControls,
	installConsole,
	type RpcLog,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	type ConcertSpec,
	organizer,
	seriesList,
	XX_SOLO,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * The concert editor in the real console: what only a browser and the real
 * router show, namely the return to the concert page after a save, the brand
 * colour, the cover image handed from the editor to the concert page, and the
 * unsaved-changes guard on a navigation click. The form itself (venues, dates,
 * times, visibility, published dates, limits, cover upload) is checked against
 * the rendered route in `test/organizer/concert-editor/concert-editor-route.spec.ts`.
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

const titleField = (page: Page) => page.getByLabel('公演名')
const snackbar = (page: Page) => page.locator('.snack-item')
const nav = (page: Page) =>
	page.getByRole('navigation', { name: 'メインナビゲーション' })
const calls = (log: RpcLog, method: string) =>
	log.calls.filter((c) => c.method === method)

test.describe('saving', () => {
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
	test(`@spec ${SPEC} "Saved before processing finished"`, async ({ page }) => {
		// The 3 s re-read runs on the page's fake clock, fast-forwarded below.
		await page.clock.install()
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
		await expect
			.poll(
				async () => {
					await page.clock.fastForward(3_000)
					return concertCover.getAttribute('src')
				},
				{ timeout: 15_000 },
			)
			.toBe(NEW_COVER)
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
