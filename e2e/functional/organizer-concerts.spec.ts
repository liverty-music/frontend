import {
	connectError,
	installConsole,
	ORG,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	artistList,
	type ConcertSpec,
	jst,
	organizer,
	payoutAccount,
	salesOf,
	seriesList,
	XX_SOLO,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Locator, type Page, test } from '../support/test'

/**
 * Concerts of a represented Artist: the concerts it performs in as cards on a
 * narrow list and as a table once the list is 840 px wide, with the empty and
 * failed states.
 */

const SPEC = 'components/infrastructure/organizer/web/route/concerts'
const TOKENS = 'components/infrastructure/organizer/web/global/design-tokens'

const NOW = new Date('2026-10-28T10:00:00+09:00')

/** XX Tour's first date has a lottery open now; every other event has no sale. */
const RPC: RpcMocks = {
	'SeriesService/List': seriesList([XX_TOUR, XX_SOLO]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'ScannerService/ListByEvent': { scanners: [] },
	'TicketSaleService/ListByEvent': (body) => {
		const id = JSON.stringify(body)
		return {
			body: id.includes('e-1103')
				? salesOf('e-1103', [
						{
							id: 'sale-1',
							name: '最速先行',
							method: 'LOTTERY',
							start: jst('2026-10-20', '12:00'),
							end: jst('2026-11-01', '23:59'),
							price: 6800,
							quantity: 1000,
						},
					])
				: salesOf('none', []),
		}
	},
}

async function openConcerts(page: Page, rpc: RpcMocks = RPC) {
	await page.clock.setFixedTime(NOW)
	const log = await installConsole(page, { rpc, language: 'ja' })
	await page.goto(SERIES)
	await expect(
		page.getByRole('heading', { level: 1, name: '公演' }),
	).toBeVisible()
	return log
}

const cards = (page: Page) =>
	page.getByRole('list', { name: '公演', exact: true }).getByRole('listitem')

function card(page: Page, title: string): Locator {
	return cards(page).filter({ has: page.getByRole('link', { name: title }) })
}

test.describe('cards or a table', () => {
	test(`@spec ${SPEC} "Phone"`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openConcerts(page)

		await expect(cards(page)).toHaveCount(2)
		await expect(page.getByRole('table')).toBeHidden()

		const tour = card(page, 'XX Tour 2026')
		await expect(
			tour.getByRole('link', { name: 'XX Tour 2026' }),
		).toHaveAttribute('href', /\/series\/s-tour$/)
		await expect(tour).toContainText('11月3日(火) 他 3公演')
		await expect(tour).toContainText('Zepp Haneda')
		await expect(tour).toContainText('受付中')
		await expect(tour).toContainText('公開中')

		const solo = card(page, 'XX 単独公演')
		await expect(solo).toContainText('12月20日(日)')
		await expect(solo).toContainText('Zepp Haneda')
		await expect(solo).toContainText('販売なし')
		await expect(solo).toContainText('下書き')
	})

	test(`@spec ${SPEC} "PC"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openConcerts(page)

		const table = page.getByRole('table')
		await expect(table).toBeVisible()
		await expect(cards(page).first()).toBeHidden()
		await expect(table.getByRole('columnheader')).toHaveText([
			'公演名',
			'日程・会場',
			'販売状態',
			'状態',
		])
		const rows = table.getByRole('rowgroup').nth(1).getByRole('row')
		await expect(rows).toHaveCount(2)
		await expect(rows.nth(0)).toContainText('XX Tour 2026')
		await expect(rows.nth(0)).toContainText('受付中')
		await expect(rows.nth(1)).toContainText('XX 単独公演')
		await expect(rows.nth(1)).toContainText('下書き')

		// Narrowing the window turns the rows back into cards.
		await page.setViewportSize({ width: 390, height: 844 })
		await expect(table).toBeHidden()
		await expect(cards(page).first()).toBeVisible()
	})

	test(`@spec ${SPEC} "Tour summary"`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openConcerts(page)
		const tour = card(page, 'XX Tour 2026')
		await expect(tour).toContainText('11月3日(火) 他 3公演 · Zepp Haneda 他')
	})
})

test.describe('concerts of an Artist', () => {
	/** Only Band B performs in YY Live. */
	const YY_LIVE: ConcertSpec = {
		id: 's-yy',
		title: 'YY Live',
		performers: [{ id: 'a-2', name: 'Band B' }],
		events: [
			{ id: 'e-yy', date: '2026-12-01', start: '19:00', venue: 'O-EAST' },
		],
	}
	const TWO_ARTISTS: RpcMocks = {
		...RPC,
		'SeriesService/List': seriesList([XX_TOUR, XX_SOLO, YY_LIVE]),
		'ArtistService/List': artistList('Band A', 'Band B'),
	}

	test(`@spec ${SPEC} "Another Artist's concert"`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openConcerts(page, TWO_ARTISTS)
		await expect(cards(page)).toHaveCount(2)
		await expect(card(page, 'XX Tour 2026')).toBeVisible()
		await expect(page.getByRole('link', { name: /YY Live/ })).toHaveCount(0)

		// Under Band A the concert is not found, though the Organizer has it.
		await page.goto(`${SERIES}/s-yy`)
		await expect(
			page.getByRole('heading', { level: 1, name: '公演が見つかりません' }),
		).toBeVisible()

		await page.goto(`${ORG}/artists/a-2/series`)
		await expect(cards(page)).toHaveCount(1)
		await expect(card(page, 'YY Live')).toBeVisible()
	})

	test(`@spec ${SPEC} "Create from an Artist"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await page.clock.setFixedTime(NOW)
		await installConsole(page, { rpc: TWO_ARTISTS, language: 'ja' })
		// Band B, the second Artist by name, so the default is not what is tested.
		await page.goto(`${ORG}/artists/a-2/series`)
		await page
			.getByRole('main')
			.getByRole('link', { name: '公演をつくる' })
			.first()
			.click()

		await expect(page).toHaveURL(/\/artists\/a-2\/series\/new$/)
		await expect(
			page.getByRole('heading', { level: 1, name: '新しい公演' }),
		).toBeVisible()
		const performers = page.getByRole('group', { name: /出演者/ })
		const options = performers.getByRole('checkbox')
		// Band B first and chosen; Band A offered, not chosen.
		await expect(performers.locator('label')).toHaveText(['Band B', 'Band A'])
		await expect(options.nth(0)).toBeChecked()
		await expect(options.nth(1)).not.toBeChecked()
	})
})

test.describe('empty and failed lists', () => {
	test(`@spec ${SPEC} "First visit"`, async ({ page }) => {
		await openConcerts(page, { ...RPC, 'SeriesService/List': seriesList([]) })
		await expect(page.getByText('まだ公演がありません。')).toBeVisible()
		const create = page
			.getByRole('main')
			.getByRole('link', { name: '公演をつくる' })
		// The header action and the empty-state action both open the editor.
		await expect(create).toHaveCount(2)
		for (const link of await create.all()) {
			await expect(link).toHaveAttribute('href', /\/series\/new$/)
		}
	})

	test(`@spec ${SPEC} "Load fails"`, async ({ page }) => {
		let reads = 0
		await openConcerts(page, {
			...RPC,
			'SeriesService/List': () => {
				reads++
				return connectError('unavailable', 'backend down', 503)
			},
		})
		const alert = page
			.getByRole('alert')
			.filter({ hasText: '公演を読み込めませんでした。' })
		await expect(alert).toBeVisible()
		const before = reads
		await alert.getByRole('button', { name: '再試行' }).click()
		await expect.poll(() => reads).toBeGreaterThan(before)
	})
})

test.describe('brand color', () => {
	test(`@spec ${TOKENS} "One primary action"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openConcerts(page)
		await expect(page.getByRole('table')).toBeVisible()
		await expect(page.getByRole('table')).toContainText('受付中')

		const primary = await page.evaluate(() => {
			const probe = document.createElement('div')
			probe.style.background = 'var(--md-color-primary)'
			document.querySelector('organizer-shell main')?.append(probe)
			const color = getComputedStyle(probe).backgroundColor
			probe.remove()
			return color
		})
		expect(primary).not.toBe('rgba(0, 0, 0, 0)')

		// Every visible control of the page, the navigation and top bar included.
		const backgrounds = await page.locator('a, button').evaluateAll((els) =>
			els
				.filter((el) => (el as HTMLElement).offsetParent !== null)
				.map((el) => ({
					// A console button's label is slotted: its text is the host's.
					text: (
						el.textContent?.trim() ||
						((el.getRootNode() as ShadowRoot).host?.textContent ?? '')
					).trim(),
					background: getComputedStyle(el).backgroundColor,
				})),
		)
		const brand = backgrounds.filter((b) => b.background === primary)
		expect(brand.map((b) => b.text)).toEqual(['公演をつくる'])
		// Each concert row is a link too, and none of them is brand-colored.
		expect(backgrounds.some((b) => b.text.includes('XX Tour 2026'))).toBe(true)
	})
})
