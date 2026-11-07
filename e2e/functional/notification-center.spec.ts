import {
	FAN_EMAIL,
	FAN_SUB,
	mockFanRpc,
	seedSignedIn,
} from '../support/fan-auth'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * The notification center and the bell against a mocked `NotificationService`
 * that keeps read state, so a marked notification stays read in the next List.
 * The push itself is not here: a notification a fan opens from the operating
 * system arrives as the link the Service Worker opens, with `?notification=`.
 */

const CAPABILITY = 'stories/review-received-notifications'
const USER = {
	user: {
		id: { value: '00000000-0000-4000-8000-c00000000002' },
		email: { value: FAN_EMAIL },
		preferredLanguage: 'ja',
		home: { countryCode: 'JP', level1: 'JP-13' },
	},
}

const ID = (n: number) => `019a0000-0000-7000-8000-00000000000${n}`
const BODY =
	'11/20のぴあアリーナMM公演のチケット抽選が落選となりました。\n前世 2026'

interface Stored {
	id: string
	title: string
	url: string
	read: boolean
}

/** Signed in, with a mocked backend holding `stored`. */
async function openAs(page: Page, stored: Stored[]): Promise<void> {
	await page.context().addInitScript(seedSignedIn, {
		sub: FAN_SUB,
		email: FAN_EMAIL,
	})
	await page.context().addInitScript(() => {
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('pwa.installed', 'true')
	})
	await mockFanRpc(page, {
		'UserService/Get': USER,
		'NotificationService/List': () => ({
			body: {
				notifications: stored.map((n) => ({
					id: { value: n.id },
					userId: { value: USER.user.id.value },
					type: 'NOTIFICATION_TYPE_LOTTERY_LOSS',
					message: {
						title: n.title,
						body: BODY,
						tag: n.id,
						data: { url: n.url },
					},
					createTime: new Date(Date.now() - 2 * 3_600_000).toISOString(),
					readTime: n.read ? new Date().toISOString() : undefined,
				})),
			},
		}),
		'NotificationService/MarkRead': (body) => {
			const id = (body.notificationId as { value: string }).value
			for (const n of stored) if (n.id === id) n.read = true
			return { body: {} }
		},
	})
}

const lotteryLoss = (n: number, read = false): Stored => ({
	id: ID(n),
	title: `[ヨルシカ] 抽選結果のお知らせ ${n}`,
	url: '/tickets',
	read,
})
const bellBadge = (page: Page) => page.getByTestId('notification-bell-badge')
const items = (page: Page) => page.getByTestId('notifications-item')

test.describe('the notification center', () => {
	test(`@spec ${CAPABILITY} "Fan without push"`, async ({ page }) => {
		// No PushSubscription exists: the notification is listed all the same.
		await openAs(page, [lotteryLoss(1)])

		await page.goto('/tickets')
		await page.getByTestId('notification-bell').click()

		await expect(page).toHaveURL(/\/notifications$/)
		await expect(items(page)).toHaveCount(1)
		await expect(items(page).first()).toContainText(
			'[ヨルシカ] 抽選結果のお知らせ',
		)
		await expect(items(page).first()).toContainText('2時間前')
	})

	test(`@spec ${CAPABILITY} "Fan with push"`, async ({ page }) => {
		// A dismissed push never calls MarkRead: it stays listed and unread.
		await openAs(page, [lotteryLoss(1)])

		await page.goto('/notifications')

		await expect(items(page)).toHaveCount(1)
		await expect(page.getByTestId('notifications-unread')).toHaveCount(1)
		await expect(bellBadge(page)).toHaveText('1')
	})

	test(`@spec ${CAPABILITY} "Three arrive at once"`, async ({ page }) => {
		await openAs(page, [lotteryLoss(1), lotteryLoss(2), lotteryLoss(3)])

		// The Service Worker opens the push's link naming the notification.
		await page.goto(`/tickets?notification=${ID(1)}`)

		await expect(bellBadge(page)).toHaveText('2')
		expect(new URL(page.url()).search).toBe('')
		await page.getByTestId('notification-bell').click()
		await expect(page.getByTestId('notifications-unread')).toHaveCount(2)
	})

	test(`@spec ${CAPABILITY} "Read in the center"`, async ({ page }) => {
		await openAs(page, [lotteryLoss(1), lotteryLoss(2), lotteryLoss(3, true)])

		await page.goto('/notifications')
		await expect(bellBadge(page)).toHaveText('2')
		await items(page).first().click()

		await expect(page).toHaveURL(/\/tickets$/)
		await expect(bellBadge(page)).toHaveText('1')

		await page.getByTestId('notification-bell').click()
		await expect(page).toHaveURL(/\/notifications$/)
		await expect(items(page).first()).toHaveAttribute('data-read', 'true')
		await expect(page.getByTestId('notifications-unread')).toHaveCount(1)
	})

	test('an empty center says so', async ({ page }) => {
		await openAs(page, [])

		await page.goto('/notifications')

		await expect(page.getByTestId('notifications-empty')).toHaveText(
			'通知はまだありません。',
		)
		await expect(bellBadge(page)).toHaveCount(0)
	})

	test('a guest sees no bell and is sent to the welcome page', async ({
		page,
	}) => {
		await mockFanRpc(page)

		await page.goto('/notifications')

		await page.waitForURL((url) => url.pathname === '/welcome')
		await expect(page.getByTestId('notification-bell')).toHaveCount(0)
		await expect(
			page.getByText('Sign in to see your notifications.'),
		).toBeVisible()
	})
})
