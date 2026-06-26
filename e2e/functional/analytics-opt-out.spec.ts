import { gunzipSync } from 'node:zlib'
import { expect, type Page, type Route, test } from '@playwright/test'

/**
 * E2E smoke test for the analytics OPT-OUT model (OpenSpec task 10.6).
 *
 * Legal/behavioural model under test (EU-adequacy opt-out, NOT a consent gate):
 *   - The `/consent` route is a one-time NON-BLOCKING transparency notice.
 *     Acknowledging it never gates onboarding and never changes the default-on
 *     posture.
 *   - Product analytics is ON by default. With no opt-out, `AnalyticsService`
 *     forwards catalogue events (e.g. `page.viewed`) to PostHog after its
 *     deferred (`requestIdleCallback`) init + pre-init-queue flush.
 *   - Settings → Analytics OFF calls `posthog.opt_out_capturing()` so no
 *     further event reaches the ingest host. Re-enabling resumes capture.
 *   - Settings → Session-replay OFF is recording-only (design Decision 12 keeps
 *     recording hard-disabled regardless), so it must NOT affect event capture.
 *
 * Harness:
 *   - Runs in the `functional` Playwright project as a GUEST (no real auth;
 *     `AuthHook` gives guests free roam, so `/consent`, `/discovery`,
 *     `/settings` are all reachable unauthenticated).
 *   - `/config.json` is intercepted to inject `posthogProjectKey` /
 *     `posthogApiHost` so `AnalyticsService` runs in REAL (non-nil) mode while
 *     keeping every other required key from the real document.
 *   - All PostHog hosts (`*.i.posthog.com` — ingest + assets/config/flags) are
 *     intercepted and fulfilled locally; ingest requests are decoded and their
 *     event names recorded for assertions. No traffic ever leaves the box.
 *   - posthog-js SILENTLY DROPS all capture when it detects an automation/bot
 *     client (it checks `navigator.webdriver` AND `navigator.userAgentData.
 *     brands`, which under Playwright contains "HeadlessChrome"). A per-page
 *     init script (`spoofNonBotClient`) clears both signals so the SDK captures
 *     normally — WITHOUT this, no event ever reaches the ingest mock.
 */

// Desktop Chrome (functional project default). A short viewport is not needed
// here — these tests assert on captured analytics, not on layout geometry.

// ---------------------------------------------------------------------------
// /config.json interception — flip AnalyticsService into real (non-nil) mode
// ---------------------------------------------------------------------------

/**
 * The real `public/config.json` shape, merged with the two PostHog keys that
 * production injects at deploy time. We MUST keep every required key
 * (`validateAppConfig` rejects a missing/empty `apiBaseUrl`, `zitadelIssuer`,
 * matching `previewArtist*` lengths, etc.) or boot fails before analytics ever
 * runs. `internalTrafficUserIds` is left empty so the guest/identify paths take
 * the normal (non-internal) branch.
 */
const TEST_CONFIG = {
	environment: 'dev',
	apiBaseUrl: 'https://api.dev.liverty-music.app',
	adminApiBaseUrl: 'https://api.admin.dev.liverty-music.app',
	zitadelIssuer: 'https://auth.dev.liverty-music.app',
	zitadelClientId: '371355407710421859',
	zitadelOrgId: '371348346264093539',
	vapidPublicKey:
		'BNg-zJP4IiX11Cz1dghWll0mwBnMV6oeOSSVsYyOK2l8NFAqN9xHFSTS_W3_oXO4k3BlMyYLjkMUE-uA7LABGHo',
	circuitBaseUrl: '/circuits/ticketcheck-v1',
	previewArtistIds: [
		'019c8655-7a05-71ef-82b4-a4ac2494e29f',
		'019c8655-7a05-721d-b0a8-4c11724d5c90',
		'019c8655-7a05-71e9-9af5-e1cd4fbfd367',
	],
	previewArtistNames: ['Mrs. GREEN APPLE', 'YOASOBI', 'Vaundy'],
	logLevel: 'debug',
	// The two keys that take AnalyticsService out of nil-config mode.
	posthogApiHost: 'https://eu.i.posthog.com',
	posthogProjectKey: 'phc_e2e_test',
	// Empty allowlist → guest/identify take the normal non-internal branch.
	internalTrafficUserIds: [] as string[],
}

/**
 * Clears the two bot signals posthog-js uses to silently suppress capture for
 * automation clients: `navigator.webdriver` (true under Playwright) and
 * `navigator.userAgentData.brands` (contains "HeadlessChrome", which matches
 * the SDK's blocked-UA list). Without this the SDK loads but every `capture` is
 * dropped before any network request, so no event reaches the ingest mock.
 */
async function spoofNonBotClient(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'webdriver', {
			get: () => false,
			configurable: true,
		})
		const nav = navigator as unknown as { userAgentData?: unknown }
		if (nav.userAgentData) {
			const brands = [
				{ brand: 'Chromium', version: '145' },
				{ brand: 'Google Chrome', version: '145' },
				{ brand: 'Not:A-Brand', version: '99' },
			]
			Object.defineProperty(nav, 'userAgentData', {
				get: () => ({
					brands,
					mobile: false,
					platform: 'Windows',
					getHighEntropyValues: async () => ({ brands }),
				}),
				configurable: true,
			})
		}
	})
}

async function mockConfig(page: Page): Promise<void> {
	await page.route('**/config.json', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(TEST_CONFIG),
		}),
	)
}

// ---------------------------------------------------------------------------
// PostHog ingest mock + captured-event recorder
// ---------------------------------------------------------------------------

/**
 * posthog-js 1.390 talks to a handful of paths on `*.i.posthog.com`:
 *   - `/flags/?v=...`            feature-flag + bootstrap decision
 *   - `/array/<token>/config`    remote SDK config (assets host)
 *   - `/array/...`               static asset / recorder bundle
 *   - `/e/`, `/i/v0/e/`, `/batch/`, `/capture/`  EVENT INGEST
 * We fulfill everything 200 so the SDK never errors, and decode ingest bodies
 * to record captured event names.
 */
const INGEST_PATH_RE = /\/(e|i\/v0\/e|batch|capture)\/?(\?|$)/

/**
 * Recorder shared by the route handler and the test assertions.
 *   - `events`: the flat list of every captured event `name` seen on an ingest
 *     request (in arrival order).
 *   - `distinctIds`: every `distinct_id` seen on an ingest request — used to
 *     assert the anonymous identity stays stable (no `reset`) across captures.
 */
type CaptureRecorder = { events: string[]; distinctIds: string[] }

/**
 * Best-effort decode of a PostHog ingest request body into a string we can
 * scan for event names. posthog-js may send the payload as:
 *   - gzip bytes (when `gzip-js` compression is active),
 *   - a `data=<base64(json)>` urlencoded form field, or
 *   - raw JSON.
 * We try each in turn and return whatever yields readable text; failures fall
 * through so a single weird encoding never throws inside the route handler.
 */
function decodeIngestBody(buf: Buffer | null): string {
	if (!buf || buf.length === 0) return ''

	// 1) gzip (magic bytes 0x1f 0x8b)
	if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
		try {
			return gunzipSync(buf).toString('utf8')
		} catch {
			// fall through
		}
	}

	const raw = buf.toString('utf8')

	// 2) urlencoded `data=<base64>` (or `compression=...&data=...`)
	const params = new URLSearchParams(raw)
	const data = params.get('data')
	if (data) {
		try {
			return Buffer.from(data, 'base64').toString('utf8')
		} catch {
			// fall through to raw
		}
	}

	// 3) raw (already-JSON, or anything else — return verbatim for substring
	// matching as a last resort)
	return raw
}

/** Pull every `"event":"<name>"` out of a decoded ingest payload. */
function extractEventNames(decoded: string): string[] {
	const names: string[] = []
	// PostHog payloads are `{event, properties, ...}` or `{batch:[{event,...}]}`.
	// Try structured parse first; fall back to a tolerant regex when the body
	// was only partially decodable.
	try {
		const json: unknown = JSON.parse(decoded)
		const collect = (node: unknown): void => {
			if (Array.isArray(node)) {
				for (const n of node) collect(n)
				return
			}
			if (node && typeof node === 'object') {
				const obj = node as Record<string, unknown>
				if (typeof obj.event === 'string') names.push(obj.event)
				if (Array.isArray(obj.batch)) collect(obj.batch)
			}
		}
		collect(json)
		if (names.length > 0) return names
	} catch {
		// fall through to regex
	}
	for (const m of decoded.matchAll(/"event"\s*:\s*"([^"]+)"/g)) {
		names.push(m[1])
	}
	return names
}

/**
 * Routes every `*.i.posthog.com` request through a local handler:
 *   - ingest paths: decode the body, record event names, fulfill `{status:1}`.
 *   - `/flags/`: return a minimal valid decision so the SDK stops probing.
 *   - `/array/.../config` and other asset paths: return an empty config so the
 *     SDK's remote-config step resolves without a network call.
 * Returns the recorder the test asserts against.
 */
async function mockPostHog(page: Page): Promise<CaptureRecorder> {
	const recorder: CaptureRecorder = { events: [], distinctIds: [] }

	const handler = (route: Route): Promise<void> => {
		const req = route.request()
		const url = req.url()

		if (INGEST_PATH_RE.test(url)) {
			const decoded = decodeIngestBody(req.postDataBuffer())
			for (const name of extractEventNames(decoded)) {
				recorder.events.push(name)
			}
			for (const m of decoded.matchAll(/"distinct_id"\s*:\s*"([^"]+)"/g)) {
				recorder.distinctIds.push(m[1])
			}
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ status: 1 }),
			})
		}

		if (url.includes('/flags/')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					featureFlags: {},
					featureFlagPayloads: {},
					sessionRecording: false,
					supportedCompression: [],
					config: { enable_collect_everything: false },
					toolbarParams: {},
					isAuthenticated: false,
				}),
			})
		}

		// /array/<token>/config, recorder bundle, and any other asset path.
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	}

	// Cover the explicit EU host and the wildcard family (assets/ingest/app).
	await page.route('**/*.i.posthog.com/**', handler)
	await page.route('https://eu.i.posthog.com/**', handler)

	return recorder
}

// ---------------------------------------------------------------------------
// RPC mock (guest, empty data) — mirrors onboarding-flow's mockRpcRoutesEmpty.
// ---------------------------------------------------------------------------

async function mockRpcRoutesEmpty(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		}),
	)
}

// ---------------------------------------------------------------------------
// Deterministic wait for a captured (or not-captured) event name. Tolerates the
// deferred requestIdleCallback init + async pre-init-queue flush.
// ---------------------------------------------------------------------------

async function expectCaptured(
	recorder: CaptureRecorder,
	name: string,
	timeout = 15_000,
): Promise<void> {
	await expect
		.poll(() => recorder.events.includes(name), { timeout })
		.toBe(true)
}

/** Count how many times a specific catalogue event name has been captured. */
function countOf(recorder: CaptureRecorder, name: string): number {
	return recorder.events.filter((e) => e === name).length
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Analytics opt-out model (guest, mocked PostHog)', () => {
	test.beforeEach(async ({ page }) => {
		// Start every test from a clean opt-out posture + unseen notice.
		// Clear any persisted opt-out blob (v2 + legacy v1) and the notice flag
		// ONCE, so each test starts from the default-on posture with an unseen
		// notice. Guarded by a session flag so it runs only on the FIRST page
		// load of the test — a per-load wipe would erase an opt-out the test
		// itself just made and is meant to survive a reload.
		await page.addInitScript(() => {
			if (!sessionStorage.getItem('__e2e_consent_reset')) {
				localStorage.removeItem('liverty:consent:state:v2')
				localStorage.removeItem('liverty:consent:state:v1')
				localStorage.removeItem('liverty:analytics:noticeSeen')
				localStorage.removeItem('onboardingComplete')
				sessionStorage.setItem('__e2e_consent_reset', '1')
			}
		})
		await spoofNonBotClient(page)
		await mockConfig(page)
		await mockRpcRoutesEmpty(page)
	})

	test('transparency notice is non-blocking and does not change default-on state', async ({
		page,
	}) => {
		const recorder = await mockPostHog(page)

		// The /consent notice is a standalone public page reachable by link; it
		// is NOT a step in onboarding. Visiting + acknowledging must navigate on
		// (to /dashboard) and never gate progression.
		await page.goto('http://localhost:9000/consent')
		await page.waitForSelector('.consent-route', { timeout: 10_000 })

		// Acknowledge → router.load('/dashboard'). Progression is never blocked.
		await page.locator('.consent-btn-primary').click()
		await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 })

		// Acknowledging records only the "seen" flag and does NOT write a consent
		// opt-out blob — the default-on posture is untouched. Capture therefore
		// still works (assertion 2 covers the positive capture; here we assert the
		// notice itself did not flip analytics off).
		const consentBlob = await page.evaluate(() =>
			localStorage.getItem('liverty:consent:state:v2'),
		)
		expect(consentBlob).toBeNull()

		// A page.viewed for the dashboard navigation still reaches PostHog,
		// proving acknowledging the notice left analytics enabled.
		await expectCaptured(recorder, 'page.viewed')
	})

	test('analytics is ON by default: page.viewed reaches PostHog', async ({
		page,
	}) => {
		const recorder = await mockPostHog(page)

		// No opt-out seeded → default-on. After deferred init + queue flush the
		// app-shell's navigation-end page.viewed capture reaches the ingest mock.
		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('.discovery-layout', { timeout: 10_000 })

		await expectCaptured(recorder, 'page.viewed')
	})

	test('Settings Analytics-off stops capture; re-enabling resumes it', async ({
		page,
	}) => {
		const recorder = await mockPostHog(page)

		await page.goto('http://localhost:9000/settings')
		await page.waitForSelector('settings-route', { timeout: 10_000 })

		// Confirm capture is alive before opting out (the settings page-view).
		await expectCaptured(recorder, 'page.viewed')

		// Toggle Analytics OFF. handleAnalyticsToggle → consent.revoke('analytics')
		// → ConsentChanged → AnalyticsService.opt_out_capturing(). The first
		// settings switch is Analytics, the second is Session-replay.
		const analyticsSwitch = page.locator('button.settings-switch').first()
		await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'true')
		await analyticsSwitch.click()
		await expect(analyticsSwitch).toHaveAttribute('aria-checked', 'false')

		// Snapshot the count of the CATALOGUE event under test (`page.viewed`).
		// We count only `page.viewed` — not posthog's own `$opt_in` / `$opt_out`
		// lifecycle events, which the SDK emits around an opt-state transition
		// and which are irrelevant to "does product analytics keep capturing".
		// Drain any in-flight capture first.
		await page.waitForTimeout(500)
		const pageViewsAfterOptOut = countOf(recorder, 'page.viewed')

		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('.discovery-layout', { timeout: 10_000 })
		// Give a generous window for any (suppressed) capture to have fired.
		await page.waitForTimeout(1500)
		expect(countOf(recorder, 'page.viewed')).toBe(pageViewsAfterOptOut)

		// Re-enable: opt back in, then a fresh navigation must capture again.
		await page.goto('http://localhost:9000/settings')
		await page.waitForSelector('settings-route', { timeout: 10_000 })
		const reSwitch = page.locator('button.settings-switch').first()
		await expect(reSwitch).toHaveAttribute('aria-checked', 'false')
		await reSwitch.click()
		await expect(reSwitch).toHaveAttribute('aria-checked', 'true')

		const pageViewsAfterOptIn = countOf(recorder, 'page.viewed')
		await page.goto('http://localhost:9000/my-artists')
		await page.waitForSelector('my-artists-route', { timeout: 10_000 })
		await expect
			.poll(() => countOf(recorder, 'page.viewed'), { timeout: 15_000 })
			.toBeGreaterThan(pageViewsAfterOptIn)
	})

	test('Session-replay toggle does not affect event capture', async ({
		page,
	}) => {
		const recorder = await mockPostHog(page)

		await page.goto('http://localhost:9000/settings')
		await page.waitForSelector('settings-route', { timeout: 10_000 })
		await expectCaptured(recorder, 'page.viewed')

		// Toggle Session-replay OFF (the SECOND switch). Per design Decision 12
		// recording is hard-disabled regardless, and the toggle only touches
		// `set_config` recording — event capture must keep working.
		const sessionReplaySwitch = page.locator('button.settings-switch').nth(1)
		await expect(sessionReplaySwitch).toHaveAttribute('aria-checked', 'true')
		await sessionReplaySwitch.click()
		await expect(sessionReplaySwitch).toHaveAttribute('aria-checked', 'false')

		// Analytics switch is untouched (still ON) — replay opt-out is independent.
		await expect(
			page.locator('button.settings-switch').first(),
		).toHaveAttribute('aria-checked', 'true')

		// A fresh navigation still captures the catalogue event: replay-off did
		// not suppress events.
		const before = countOf(recorder, 'page.viewed')
		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('.discovery-layout', { timeout: 10_000 })
		await expect
			.poll(() => countOf(recorder, 'page.viewed'), { timeout: 15_000 })
			.toBeGreaterThan(before)
	})

	/**
	 * Assertion 5 (identify merge) is REDUCED to its weaker observable form.
	 *
	 * Why the full network assertion is impractical here: `identify` fires only
	 * from `UserHydrationTask`, which returns early unless `auth.isAuthenticated`
	 * is true. The `functional` project runs as an unauthenticated GUEST with no
	 * OIDC session, so the hydration task never reaches the `identify` call —
	 * mocking the user RPC does NOT help, because the gate is the auth state, not
	 * the RPC. Driving a real identify would require an authenticated
	 * storageState (the `authenticated` project), which is storageState-gated and
	 * never runs in CI. Faking an `identify` request would assert nothing real.
	 *
	 * What we CAN assert deterministically (and what the merge model actually
	 * guarantees): the anonymous pre-identification history is never dropped —
	 * capture runs under a single stable anonymous id across navigations with NO
	 * intervening `reset`. AnalyticsService only calls `posthog.reset()` on
	 * sign-out or analytics opt-out; on the default-on guest path it never does,
	 * so the anonymous `distinct_id` stays constant across page views. That
	 * constant id is exactly what `identify` (no preceding reset) later MERGES
	 * into the identified profile. We assert the id is present and stable across
	 * two captures.
	 */
	test('anonymous identity is stable across captures (merge precondition: no reset)', async ({
		page,
	}) => {
		const recorder = await mockPostHog(page)

		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('.discovery-layout', { timeout: 10_000 })
		await expectCaptured(recorder, 'page.viewed')

		await page.goto('http://localhost:9000/settings')
		await page.waitForSelector('settings-route', { timeout: 10_000 })

		// At least two captures (two page views), and the anonymous id is stable
		// across them — no reset() severed the anonymous funnel, so a later
		// identify will merge this history rather than orphan it.
		await expect
			.poll(() => recorder.distinctIds.length, { timeout: 15_000 })
			.toBeGreaterThanOrEqual(2)
		const unique = new Set(recorder.distinctIds)
		expect(unique.size).toBe(1)
	})
})
