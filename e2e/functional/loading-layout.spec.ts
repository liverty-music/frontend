import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import {
	FAN_EMAIL,
	FAN_SUB,
	mockFanRpc,
	seedSignedIn,
} from '../support/fan-auth'
import { expect, type Page, test } from '../support/test'
import { mockBackend } from '../support/virtual-ticket-backend'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 90_000 })
test.use({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' })

/**
 * What a screen shows while its data loads takes the room of what replaces it
 * (ui-primitives "Content that loads shows a skeleton and fades in"). Each
 * screen's data is held back, the skeleton's rows are measured, then the data
 * is released and the loaded rows are measured: a row differs by at most
 * `TOLERANCE` px, a page by at most `PAGE_TOLERANCE` px.
 */

const UI = 'components/infrastructure/fan/web/global/ui-primitives'
const TOLERANCE = 12
// A page's height follows its details, so its placeholder is only near it.
const PAGE_TOLERANCE = 48
const USER = {
	user: {
		id: { value: FAN_SUB },
		email: { value: FAN_EMAIL },
		preferredLanguage: 'ja',
		home: { countryCode: 'JP', level1: 'JP-13' },
	},
}

async function signedIn(page: Page): Promise<void> {
	await page.context().addInitScript(seedSignedIn, {
		sub: FAN_SUB,
		email: FAN_EMAIL,
	})
	await page.context().addInitScript(() => {
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('pwa.installed', 'true')
	})
}

/** A promise a test settles by hand, so the data is released when it says. */
function gate(): { wait: Promise<void>; open: () => void } {
	let open = () => {}
	const wait = new Promise<void>((resolve) => {
		open = resolve
	})
	return { wait, open }
}

/** Wait until every finite animation has ended, so the boxes are at rest. */
const fadesDone = (page: Page) =>
	page.waitForFunction(() =>
		document
			.getAnimations()
			.filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
			.every((a) => a.playState === 'finished'),
	)

const heights = (page: Page, selector: string) =>
	page
		.locator(selector)
		.evaluateAll((els) =>
			els.map((el) => Math.round(el.getBoundingClientRect().height)),
		)

test(`@spec ${UI} "List loads" notifications`, async ({ page }) => {
	await signedIn(page)
	const release = gate()
	const stored = [1, 2, 3].map((n) => ({
		id: `019a0000-0000-7000-8000-00000000000${n}`,
		title: `[ヨルシカ] 抽選結果のお知らせ ${n}`,
	}))
	await mockFanRpc(page, {
		'UserService/Get': USER,
		'NotificationService/List': async () => {
			await release.wait
			return {
				body: {
					notifications: stored.map((n) => ({
						id: { value: n.id },
						userId: { value: USER.user.id.value },
						type: 'NOTIFICATION_TYPE_LOTTERY_LOSS',
						message: {
							title: n.title,
							body: '11/20のぴあアリーナMM公演のチケット抽選が落選となりました。\n前世 2026',
							tag: n.id,
							data: { url: '/tickets' },
						},
						createTime: new Date(Date.now() - 2 * 3_600_000).toISOString(),
					})),
				},
			}
		},
	})

	await page.goto('/notifications')
	await page
		.locator('notifications-route state-placeholder .skeleton-row')
		.first()
		.waitFor({ timeout: 60_000 })
	const skeleton = await heights(
		page,
		'notifications-route state-placeholder .skeleton-row',
	)
	release.open()
	await page.getByTestId('notifications-item').first().waitFor()
	await fadesDone(page)
	const loaded = await heights(page, '[data-testid="notifications-item"]')

	console.log('notifications skeleton rows', skeleton, 'loaded rows', loaded)
	expect(Math.abs(skeleton[0] - loaded[0])).toBeLessThanOrEqual(TOLERANCE)
})

test(`@spec ${UI} "List loads" concert page`, async ({ page }) => {
	await signedIn(page)
	const release = gate()
	const eventId = fakeId('loading-layout-event')
	const d = new Date()
	d.setDate(d.getDate() + 30)
	const concert = {
		id: { value: eventId },
		performers: [
			{
				id: { value: fakeId('loading-layout-artist') },
				name: { value: 'The Band' },
				mbid: { value: '' },
			},
		],
		series: {
			id: { value: fakeId('loading-layout-series') },
			title: { value: 'XX Tour 2026' },
			publishState: 'PUBLISH_STATE_PUBLISHED',
		},
		localDate: {
			value: {
				year: d.getFullYear(),
				month: d.getMonth() + 1,
				day: d.getDate(),
			},
		},
		venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
	}
	await mockFanRpc(page, {
		'UserService/Get': USER,
		'ConcertService/Get': async () => {
			await release.wait
			return { body: concertWire({ concert }) }
		},
		'ConcertService/ListBySeries': async () => {
			await release.wait
			return { body: concertWire({ concerts: [concert] }) }
		},
	})

	await page.goto(`/concerts/${eventId}`)
	await page
		.locator('concert-route state-placeholder .skeleton-row')
		.first()
		.waitFor({ timeout: 60_000 })
	const skeleton = await heights(
		page,
		'concert-route state-placeholder .skeleton-row',
	)
	const skeletonTotal = await page
		.locator('concert-route state-placeholder')
		.evaluate((el) => Math.round(el.getBoundingClientRect().height))
	release.open()
	await page.getByTestId('event-share').waitFor()
	await fadesDone(page)
	const loadedTotal = await page
		.locator('.concert-page')
		.evaluate((el) => Math.round(el.getBoundingClientRect().height))

	console.log(
		'concert skeleton rows',
		skeleton,
		'skeleton total',
		skeletonTotal,
		'loaded page',
		loadedTotal,
	)
	// The page the placeholder stands for is about as tall as the placeholder.
	expect(Math.abs(skeletonTotal - loadedTotal)).toBeLessThanOrEqual(
		PAGE_TOLERANCE,
	)
})

test(`@spec ${UI} "List loads" tickets`, async ({ page }) => {
	await mockBackend(page)
	const release = gate()
	// Registered after the backend's own answer, so it runs first and then
	// hands the call on to it once the test says so.
	await page.route('**/*TicketService/List', async (route) => {
		await release.wait
		return route.fallback()
	})

	await page.goto('/tickets')
	await page
		.locator('tickets-route state-placeholder .skeleton-row')
		.first()
		.waitFor({ timeout: 60_000 })
	const skeleton = await heights(
		page,
		'tickets-route state-placeholder .skeleton-row',
	)
	release.open()
	await page.locator('.tickets-event').first().waitFor()
	await fadesDone(page)
	const [event] = await heights(page, '.tickets-event')
	const tickets = await heights(
		page,
		'.tickets-event [data-testid="tickets-card"]',
	)
	console.log(
		'tickets skeleton rows',
		skeleton,
		'event',
		event,
		'tickets',
		tickets,
	)

	// The placeholder is an event with one ticket: the loaded event less every
	// ticket after the first.
	const oneTicket = event - tickets.slice(1).reduce((sum, h) => sum + h, 0)
	expect(skeleton).toHaveLength(1)
	expect(Math.abs(skeleton[0] - oneTicket)).toBeLessThanOrEqual(PAGE_TOLERANCE)
})
