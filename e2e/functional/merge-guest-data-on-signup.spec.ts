import { fakeId } from '../support/fake-id'
import {
	callsOf,
	connectError,
	FAN_EMAIL,
	FAN_SUB,
	type FanRpcAnswer,
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

/** Follow fails for the given artists, succeeds for the others. */
function followFailingFor(ids: string[]): FanRpcAnswer {
	return (body) =>
		ids.includes((body.artistId as { value: string }).value)
			? connectError('unavailable', 503)
			: { body: {} }
}

/**
 * Sign up from the My Artists signup banner as a guest and wait until the app
 * leaves the callback.
 */
async function signUpFromMyArtists(page: Page): Promise<void> {
	await mockIdentityProvider(page)
	await page.goto('/my-artists')
	await page.locator('.signup-banner-action').click({ timeout: 20_000 })
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
}

/**
 * Sign in from Settings as a guest (this entry keeps the guest data) and wait
 * until the app leaves the callback.
 */
async function signInFromSettings(page: Page): Promise<void> {
	await mockIdentityProvider(page)
	await page.goto('/settings')
	await page.getByTestId('settings-sign-in').click({ timeout: 20_000 })
	await expect(page).not.toHaveURL(/\/(settings|auth\/callback)/, {
		timeout: 20_000,
	})
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

	test(`@spec ${STORY} "Reconciliation does not resurrect reverted state"`, async ({
		page,
	}) => {
		await seedOnce(page, [{ artist: A, hype: 'away' }], {
			onboardingComplete: 'true',
			[`guestMerged:${USER_ID}`]: '1',
		})
		await page
			.context()
			.addInitScript(seedSignedIn, { sub: FAN_SUB, email: FAN_EMAIL })
		const calls = await mockFanRpc(page, { 'UserService/Get': USER })

		await page.goto('/my-artists')

		await expect.poll(() => guestQueue(page), { timeout: 20_000 }).toEqual([])
		expect(callsOf(calls, 'FollowService/Follow')).toEqual([])
		expect(callsOf(calls, 'FollowService/SetHype')).toEqual([])
	})

	test(`@spec ${STORY} "Per-item drain for the follow queue"`, async ({
		page,
	}) => {
		await seedOnce(
			page,
			[
				{ artist: A, hype: 'nearby' },
				{ artist: B, hype: 'nearby' },
				{ artist: C, hype: 'nearby' },
			],
			{ onboardingComplete: 'true' },
		)
		await page
			.context()
			.addInitScript(seedSignedIn, { sub: FAN_SUB, email: FAN_EMAIL })
		const first = await mockFanRpc(page, {
			'UserService/Get': USER,
			'FollowService/Follow': followFailingFor([B.id]),
		})

		await page.goto('/my-artists')

		// Each artist leaves the queue as its Follow succeeds: only B is left.
		await expect
			.poll(async () => (await guestQueue(page)).map((e) => e.artist.id), {
				timeout: 20_000,
			})
			.toEqual([B.id])
		expect(followedIds(first).sort()).toEqual([A.id, B.id, C.id].sort())
		expect(await storage(page, `guestMerged:${USER_ID}`)).toBeNull()

		// The next start (a new tab) retries only the failed item.
		const next = await page.context().newPage()
		const second = await mockFanRpc(next, { 'UserService/Get': USER })
		await next.goto('/my-artists')
		await expect
			.poll(() => storage(next, `guestMerged:${USER_ID}`), { timeout: 20_000 })
			.toBe('1')
		expect(followedIds(second)).toEqual([B.id])
		expect(await guestQueue(next)).toEqual([])
	})
})

test.describe('guest data storage', () => {
	test(`@spec ${STORY} "Followed artists stored locally with hype"`, async ({
		page,
	}) => {
		await seedOnce(page, [], {
			onboardingComplete: 'false',
			'guest.home': 'JP-13',
		})
		const artists = [A, B, C].map((a) => ({
			id: { value: a.id },
			name: { value: a.name },
			mbid: { value: '' },
		}))
		await mockFanRpc(page, { 'ArtistService/ListTop': { artists } })
		await page.route('**/ws.audioscrobbler.com/**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: '{}',
			}),
		)

		await page.goto('/discovery')
		const canvas = page.locator('dna-orb-canvas canvas')
		await canvas.waitFor({ timeout: 20_000 })

		// Tap one bubble with the keyboard (the canvas's accessible path).
		await expect
			.poll(
				async () => {
					if ((await guestQueue(page)).length === 0) {
						await canvas.focus()
						await page.keyboard.press('ArrowRight')
						await page.keyboard.press('Enter')
					}
					return (await guestQueue(page)).length
				},
				{ timeout: 20_000, intervals: [500] },
			)
			.toBe(1)
		const [entry] = await guestQueue(page)
		expect([A.id, B.id, C.id]).toContain(entry.artist.id)
		expect(entry.hype).toBe('nearby')
	})

	test(`@spec ${STORY} "Hype update stored inline in follow entry"`, async ({
		page,
	}) => {
		await seedOnce(
			page,
			[
				{ artist: A, hype: 'nearby' },
				{ artist: B, hype: 'nearby' },
			],
			{ onboardingComplete: 'true', 'guest.home': 'JP-13' },
		)
		await mockFanRpc(page)
		await page.goto('/my-artists')
		await setHypeOnRow(page, 1, 'away')

		await expect
			.poll(() => guestQueue(page))
			.toEqual([
				{ artist: A, hype: 'nearby' },
				{ artist: B, hype: 'away' },
			])
	})

	test(`@spec ${STORY} "Legacy data read with hype fallback"`, async ({
		page,
	}) => {
		// Old GuestFollow entries: no hype field.
		await seedOnce(page, [{ artist: A }, { artist: B }], {
			onboardingComplete: 'true',
			'guest.home': 'JP-13',
		})
		await mockFanRpc(page)
		const errors: string[] = []
		page.on('pageerror', (e) => errors.push(e.message))

		await page.goto('/my-artists')

		const rows = page.locator('[data-artist-rows] .artist-row')
		await expect(rows).toHaveCount(2, { timeout: 20_000 })
		for (let i = 0; i < 2; i++) {
			await expect(
				rows.nth(i).locator('.hype-dot[data-active="true"]'),
			).toHaveAttribute('data-level', 'nearby')
		}
		expect((await guestQueue(page)).map((e) => e.artist.id)).toEqual([
			A.id,
			B.id,
		])
		expect(errors).toEqual([])
	})

	test(`@spec ${STORY} "Home area selection stored locally"`, async ({
		page,
	}) => {
		await seedOnce(page, [{ artist: A, hype: 'nearby' }], {
			onboardingComplete: 'false',
		})
		await mockFanRpc(page)

		await page.goto('/dashboard')
		const sheet = page.locator('user-home-selector bottom-sheet')
		await expect(sheet).toBeVisible({ timeout: 20_000 })
		await sheet.locator('.selector-option').first().click()

		await expect.poll(() => storage(page, 'guest.home')).toMatch(/^JP-\d{2}$/)
	})
})

test.describe('data merge on authentication', () => {
	test(`@spec ${STORY} "Guest hype merged from follow entries"`, async ({
		page,
	}) => {
		await seedOnce(
			page,
			[
				{ artist: A, hype: 'away' },
				{ artist: B, hype: 'nearby' },
				{ artist: C, hype: 'home' },
			],
			{ onboardingComplete: 'true', 'guest.home': 'JP-13' },
		)
		const calls = await mockFanRpc(page, { 'UserService/Get': USER })

		await signUpFromMyArtists(page)

		await expect
			.poll(() => hypeCalls(calls), { timeout: 20_000 })
			.toEqual([
				[A.id, 'HYPE_TYPE_AWAY'],
				[C.id, 'HYPE_TYPE_HOME'],
			])
		// Each SetHype comes after that artist's Follow.
		for (const id of [A.id, C.id]) {
			const follow = calls.findIndex(
				(c) =>
					c.method === 'FollowService/Follow' &&
					(c.body.artistId as { value: string }).value === id,
			)
			const setHype = calls.findIndex(
				(c) =>
					c.method === 'FollowService/SetHype' &&
					(c.body.artistId as { value: string }).value === id,
			)
			expect(follow).toBeGreaterThanOrEqual(0)
			expect(setHype).toBeGreaterThan(follow)
		}
	})

	test(`@spec ${STORY} "Hype merge failure is non-blocking"`, async ({
		page,
	}) => {
		await seedOnce(
			page,
			[
				{ artist: A, hype: 'away' },
				{ artist: B, hype: 'nearby' },
				{ artist: C, hype: 'home' },
			],
			{ onboardingComplete: 'true', 'guest.home': 'JP-13' },
		)
		const calls = await mockFanRpc(page, {
			'UserService/Get': USER,
			// SetHype fails for A only.
			'FollowService/SetHype': (body) =>
				(body.artistId as { value: string }).value === A.id
					? connectError('unavailable', 503)
					: { body: {} },
		})
		const warnings: string[] = []
		page.on('console', (m) => {
			if (m.type() === 'warning') warnings.push(m.text())
		})

		await signUpFromMyArtists(page)

		// The hype calls after the failed one still run.
		await expect
			.poll(
				() =>
					hypeCalls(calls).some(
						([id, hype]) => id === C.id && hype === 'HYPE_TYPE_HOME',
					),
				{ timeout: 20_000 },
			)
			.toBe(true)
		// The artist whose hype failed stays for boot reconciliation.
		await expect
			.poll(async () => (await guestQueue(page)).map((e) => e.artist.id))
			.toEqual([A.id])
		expect((await guestQueue(page))[0].hype).toBe('away')
		expect(await storage(page, `guestMerged:${USER_ID}`)).toBeNull()
		// The failure is logged.
		expect(
			warnings.some((w) => w.includes('Failed to set hype during migration')),
		).toBe(true)
	})

	test(`@spec ${STORY} "Guest data cleared after merge"`, async ({ page }) => {
		await seedOnce(
			page,
			[
				{ artist: A, hype: 'nearby' },
				{ artist: B, hype: 'away' },
			],
			{ onboardingComplete: 'true', 'guest.home': 'JP-13' },
		)
		const calls = await mockFanRpc(page, { 'UserService/Get': USER })

		await signUpFromMyArtists(page)

		await expect.poll(() => guestQueue(page), { timeout: 20_000 }).toEqual([])
		expect(followedIds(calls).sort()).toEqual([A.id, B.id].sort())
	})

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

	test(`@spec ${STORY} "Identity already has an account"`, async ({ page }) => {
		await seedOnce(page, [{ artist: A, hype: 'nearby' }], {
			onboardingComplete: 'true',
			'guest.home': 'JP-27',
			language: 'en',
		})
		// The identity already has a User with its own home and language.
		const calls = await mockFanRpc(page, { 'UserService/Get': USER })

		await signInFromSettings(page)

		// Get finds the account, Create is not called, and the follow
		// migration continues.
		await expect
			.poll(() => followedIds(calls), { timeout: 20_000 })
			.toEqual([A.id])
		expect(callsOf(calls, 'UserService/Get').length).toBeGreaterThan(0)
		expect(callsOf(calls, 'UserService/Create')).toEqual([])
		// The guest's home and language are not applied to the account.
		expect(callsOf(calls, 'UserService/SetHome')).toEqual([])
		expect(callsOf(calls, 'UserService/SetPreferredLanguage')).toEqual([])
		expect(await storage(page, 'guest.home')).toBeNull()
	})

	test(`@spec ${STORY} "Guest follow at the default level does not overwrite the account's level"`, async ({
		page,
	}) => {
		// The guest followed A at the default Nearby; the account follows A at Away.
		await seedOnce(page, [{ artist: A, hype: 'nearby' }], {
			onboardingComplete: 'true',
			'guest.home': 'JP-13',
		})
		const calls = await mockFanRpc(page, {
			'UserService/Get': USER,
			'FollowService/List': {
				artists: [
					{
						artist: { id: { value: A.id }, name: { value: A.name } },
						hype: 'HYPE_TYPE_AWAY',
					},
				],
			},
		})

		await signUpFromMyArtists(page)

		await expect
			.poll(() => followedIds(calls), { timeout: 20_000 })
			.toEqual([A.id])
		await expect.poll(() => guestQueue(page)).toEqual([])
		// No SetHype: the account's Away is not overwritten with Nearby.
		expect(callsOf(calls, 'FollowService/SetHype')).toEqual([])
	})

	test(`@spec ${STORY} "Follow call fails during merge"`, async ({ page }) => {
		await seedOnce(
			page,
			[
				{ artist: A, hype: 'nearby' },
				{ artist: B, hype: 'nearby' },
				{ artist: C, hype: 'away' },
			],
			{ onboardingComplete: 'false', 'guest.home': 'JP-13' },
		)
		const calls = await mockFanRpc(page, {
			'UserService/Get': USER,
			'FollowService/Follow': followFailingFor([B.id]),
		})
		const warnings: string[] = []
		page.on('console', (m) => {
			if (m.type() === 'warning') warnings.push(m.text())
		})

		await signUpFromMyArtists(page)

		// Best-effort: the calls after the failed one still run.
		await expect
			.poll(() => hypeCalls(calls), { timeout: 20_000 })
			.toEqual([[C.id, 'HYPE_TYPE_AWAY']])
		expect(followedIds(calls)).toEqual([A.id, B.id, C.id])
		// Onboarding is still marked complete (`onboardingComplete`).
		expect(await storage(page, 'onboardingComplete')).toBe('true')
		// Only the failed artist is left for boot reconciliation.
		await expect
			.poll(async () => (await guestQueue(page)).map((e) => e.artist.id))
			.toEqual([B.id])
		expect(await storage(page, `guestMerged:${USER_ID}`)).toBeNull()
		// The failure is logged.
		expect(
			warnings.some((w) =>
				w.includes('Failed to follow artist during migration'),
			),
		).toBe(true)
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
		await page.locator('.signup-banner-action').click({ timeout: 20_000 })

		// Until Create completes the sign-in callback screen shows the loading
		// indicator and does not navigate.
		await expect
			.poll(() => callsOf(calls, 'UserService/Create').length, {
				timeout: 20_000,
			})
			.toBeGreaterThan(0)
		await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
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
async function setHypeOnRow(page: Page, row: number, hype: Hype) {
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
