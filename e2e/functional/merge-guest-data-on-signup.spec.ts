import { fakeId } from '../support/fake-id'
import {
	callsOf,
	connectError,
	FAN_EMAIL,
	FAN_SUB,
	mockFanRpc,
	mockIdentityProvider,
	type RpcCall,
	seedSignedIn,
} from '../support/fan-auth'
import { enableAnalytics, named, recordPostHog } from '../support/posthog'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * The story of a guest's data (follows with hype, home area) kept on the
 * device during onboarding and merged into the account on sign-up, or on the
 * next authenticated start when a merge was left unfinished. The backend and
 * the identity provider are mocked; RPC calls are recorded.
 */

const STORY = 'stories/merge-guest-data-on-signup'
const USER_ID = '00000000-0000-4000-8000-c00000000001'

const A = { id: fakeId('merge-artist-a'), name: 'Artist A', mbid: '' }
const B = { id: fakeId('merge-artist-b'), name: 'Artist B', mbid: '' }
const C = { id: fakeId('merge-artist-c'), name: 'Artist C', mbid: '' }

type Hype = 'watch' | 'home' | 'nearby' | 'away'
type Entry = { artist: typeof A; hype?: Hype }

const USER = {
	user: {
		id: { value: USER_ID },
		email: { value: FAN_EMAIL },
		preferredLanguage: 'ja',
		home: { countryCode: 'JP', level1: 'JP-13' },
	},
}

/**
 * Seed the device once (not on every load of the test's pages): the guest
 * follow queue and any other localStorage entries.
 */
async function seedOnce(
	page: Page,
	entries: Entry[],
	extra: Record<string, string> = {},
): Promise<void> {
	await page.context().addInitScript(
		({ entries, extra }) => {
			if (localStorage.getItem('__e2e_seeded')) return
			localStorage.setItem('__e2e_seeded', '1')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('onboarding.helpSeen:discovery', '1')
			localStorage.setItem('onboarding.helpSeen:my-artists', '1')
			localStorage.setItem('guest.followedArtists', JSON.stringify(entries))
			for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v)
		},
		{ entries, extra },
	)
}

function storage(page: Page, key: string): Promise<string | null> {
	return page.evaluate((k) => localStorage.getItem(k), key)
}

async function guestQueue(page: Page): Promise<Entry[]> {
	return JSON.parse((await storage(page, 'guest.followedArtists')) ?? '[]')
}

/**
 * The artists Follow was called for, in first-call order. A failed call is
 * retried by the transport, so an artist appears once however often it was
 * tried.
 */
function followedIds(calls: RpcCall[]): string[] {
	return [
		...new Set(
			callsOf(calls, 'FollowService/Follow').map(
				(c) => (c.body.artistId as { value: string }).value,
			),
		),
	]
}

function hypeCalls(calls: RpcCall[]): [string, string][] {
	return callsOf(calls, 'FollowService/SetHype').map((c) => [
		(c.body.artistId as { value: string }).value,
		c.body.hype as string,
	])
}

/**
 * Sign up from the My Artists signup banner as a guest and wait until the app
 * leaves the callback.
 */
async function signUpFromMyArtists(page: Page): Promise<void> {
	await mockIdentityProvider(page)
	await page.goto('/my-artists')
	await page
		.locator('signup-prompt-banner .bottom-banner-action')
		.click({ timeout: 20_000 })
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
}

test.describe('boot reconciliation of unmerged guest data', () => {
	test(`@spec ${STORY} "Leftover guest data migrated on first authenticated boot"`, async ({
		page,
	}) => {
		await seedOnce(
			page,
			[
				{ artist: A, hype: 'nearby' },
				{ artist: B, hype: 'nearby' },
			],
			{
				onboardingComplete: 'true',
			},
		)
		await page
			.context()
			.addInitScript(seedSignedIn, { sub: FAN_SUB, email: FAN_EMAIL })
		const calls = await mockFanRpc(page, { 'UserService/Get': USER })

		await page.goto('/my-artists')

		await expect
			.poll(() => storage(page, `guestMerged:${USER_ID}`), { timeout: 20_000 })
			.toBe('1')
		expect(followedIds(calls).sort()).toEqual([A.id, B.id].sort())
		expect(await guestQueue(page)).toEqual([])
	})
})

test.describe('data merge on authentication', () => {
	test(`@spec ${STORY} "Successful data merge"`, async ({ page }) => {
		await seedOnce(
			page,
			[
				{ artist: A, hype: 'nearby' },
				{ artist: B, hype: 'away' },
			],
			{ onboardingComplete: 'true', 'guest.home': 'JP-27', language: 'ja' },
		)
		const calls = await mockFanRpc(page, {
			// No User yet for this identity: sign-up creates it.
			'UserService/Get': () => connectError('not_found', 404),
			'UserService/Create': USER,
		})

		await signUpFromMyArtists(page)

		const [create] = callsOf(calls, 'UserService/Create')
		expect(create?.body).toMatchObject({
			email: { value: FAN_EMAIL },
			preferredLanguage: 'ja',
			home: { countryCode: 'JP', level1: 'JP-27' },
		})
		// The guest home/language slice is cleared once the account exists.
		await expect.poll(() => storage(page, 'guest.home')).toBeNull()
		// GuestMigrationRequested: the follow store follows each artist (and
		// sets the non-default hype), then clears its own queue.
		await expect
			.poll(() => followedIds(calls).sort(), { timeout: 20_000 })
			.toEqual([A.id, B.id].sort())
		await expect
			.poll(() => hypeCalls(calls))
			.toEqual([[B.id, 'HYPE_TYPE_AWAY']])
		await expect.poll(() => guestQueue(page)).toEqual([])
		// Create follows the Get that found no User.
		const getIndex = calls.findIndex((c) => c.method === 'UserService/Get')
		const createIndex = calls.findIndex(
			(c) => c.method === 'UserService/Create',
		)
		expect(createIndex).toBeGreaterThan(getIndex)
	})

	test(`@spec ${STORY} "Guest with five follows signs up"`, async ({
		page,
	}) => {
		const artists = ['1', '2', '3', '4', '5'].map((n) => ({
			id: fakeId(`merge-five-${n}`),
			name: `Artist ${n}`,
			mbid: '',
		}))
		await seedOnce(
			page,
			artists.map((artist) => ({ artist })),
			{ onboardingComplete: 'true', 'guest.home': 'JP-13', language: 'ja' },
		)
		await mockFanRpc(page, {
			'UserService/Get': () => connectError('not_found', 404),
			'UserService/Create': USER,
		})
		await enableAnalytics(page)
		const events = await recordPostHog(page)

		await signUpFromMyArtists(page)

		await expect
			.poll(() => named(events, 'guest.follows.merged'), { timeout: 20_000 })
			.toHaveLength(1)
		const [merged] = named(events, 'guest.follows.merged')
		expect(merged.properties).toMatchObject({
			merged_count: 5,
			// Sent for the new account.
			distinct_id: USER_ID,
		})
	})

	test(`@spec ${STORY} "Merge progress indication"`, async ({ page }) => {
		await seedOnce(page, [{ artist: A, hype: 'nearby' }], {
			onboardingComplete: 'true',
			'guest.home': 'JP-13',
		})
		let releaseUser: () => void = () => {}
		const userGate = new Promise<void>((r) => {
			releaseUser = r
		})
		const calls = await mockFanRpc(page, {
			// No User yet: sign-up creates it, and Create is held.
			'UserService/Get': () => connectError('not_found', 404),
			'UserService/Create': async () => {
				await userGate
				return { body: USER }
			},
			// Follow migration never finishes: it must not hold navigation.
			'FollowService/Follow': () => new Promise(() => {}),
		})
		await mockIdentityProvider(page)
		await page.goto('/my-artists')
		await page
			.locator('signup-prompt-banner .bottom-banner-action')
			.click({ timeout: 20_000 })

		// Until Create completes the sign-in callback screen shows the loading
		// indicator and does not navigate.
		await expect
			.poll(() => callsOf(calls, 'UserService/Create').length, {
				timeout: 20_000,
			})
			.toBeGreaterThan(0)
		await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
		// biome-ignore lint/suspicious/noPlaywrightWaitForTimeout: checks that the screen stays on the callback over time
		await page.waitForTimeout(1000)
		await expect(page).toHaveURL(/\/auth\/callback/)
		await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()

		releaseUser()
		await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
		// Navigated while the follow migration is still in flight.
		await expect
			.poll(() => callsOf(calls, 'FollowService/Follow').length)
			.toBeGreaterThan(0)
	})
})

/** Pick a hype level on the n-th artist row of My Artists. */
async function _setHypeOnRow(page: Page, row: number, hype: Hype) {
	const radios = page
		.locator('[data-artist-rows] .artist-row')
		.nth(row)
		.locator('input[type="radio"]')
	await expect(radios.first()).toBeAttached({ timeout: 20_000 })
	await page.evaluate(
		({ row, hype }) => {
			const tr = document.querySelectorAll('[data-artist-rows] .artist-row')[
				row
			]
			const dots = [...tr.querySelectorAll('.hype-dot')]
			const index = dots.findIndex(
				(d) => (d as HTMLElement).dataset.level === hype,
			)
			const radio = tr.querySelectorAll<HTMLInputElement>(
				'input[type="radio"]',
			)[index]
			radio.dispatchEvent(new Event('change', { bubbles: true }))
		},
		{ row, hype },
	)
}
