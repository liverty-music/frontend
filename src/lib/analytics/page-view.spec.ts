import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Runs the real posthog-js (no SDK stub) so the page-view, page-leave and
// campaign-key behaviour is the SDK's own, observed at `before_send`: what
// these tests collect is what would leave the device.

const SPEC = 'components/infrastructure/fan/web/global/analytics'

interface SentEvent {
	event: string
	properties: Record<string, unknown>
	$set?: Record<string, unknown>
	$set_once?: Record<string, unknown>
}

const sent: SentEvent[] = []

vi.mock('./error-report-filter', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./error-report-filter')>()
	return {
		filterAnalyticsEvent: <T extends object>(
			event: T | null,
			origin: string,
		) => {
			const out = actual.filterAnalyticsEvent(event, origin)
			if (out !== null) sent.push(out as unknown as SentEvent)
			return out
		},
	}
})

const mockConsent = { analytics: true, sessionReplay: false }
// A fresh project key per test gives each SDK instance its own storage.
let projectKey = ''

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	const logger = {
		scopeTo: () => ({
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		}),
	}
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			switch ((token as { friendlyName?: string }).friendlyName) {
				case 'ILogger':
					return logger
				case 'IAppConfig':
					return {
						posthogProjectKey: projectKey,
						posthogApiHost: 'https://ph.example.test',
						internalTrafficUserIds: [],
					}
				case 'IConsentService':
					return mockConsent
				case 'IEventAggregator':
				case 'IRouterEvents':
					return { subscribe: () => ({ dispose: () => {} }) }
				default:
					return {}
			}
		}),
	}
})

import type { AnalyticsService } from './analytics-service'

// The SDK patches `history.pushState` once and skips an already patched
// method, so each test restores the originals before its SDK starts.
const originalPushState = window.history.pushState
const originalReplaceState = window.history.replaceState
let current: AnalyticsService | null = null
let testIndex = 0

function pageviews(): string[] {
	return sent
		.filter((e) => e.event === '$pageview')
		.map((e) => e.properties.$pathname as string)
}

/** Lets the SDK's deferred page view (one microtask after pushState) run. */
async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0))
}

async function start(path: string): Promise<AnalyticsService> {
	window.history.replaceState(null, '', path)
	// posthog-js is loaded outside the module registry, so `resetModules`
	// does not renew its default instance: give each test its own.
	vi.doMock('posthog-js', async () => {
		const actual =
			await vi.importActual<typeof import('posthog-js')>('posthog-js')
		return { default: new actual.PostHog() }
	})
	const { AnalyticsService } = await import('./analytics-service')
	const sut = new AnalyticsService()
	current = sut
	await sut._waitForInitForTests()
	await settle()
	return sut
}

describe('page views and campaign values (real SDK)', () => {
	beforeEach(async () => {
		sent.length = 0
		mockConsent.analytics = true
		projectKey = `phc_test_${testIndex++}`
		// Each test gets a fresh SDK singleton.
		vi.resetModules()
		window.history.pushState = originalPushState
		window.history.replaceState = originalReplaceState
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 200 })),
		)
		const g = globalThis as { requestIdleCallback?: unknown }
		delete g.requestIdleCallback
	})

	afterEach(() => {
		// The previous SDK keeps its window listeners (pagehide): silence it.
		;(
			current as unknown as { posthog: { opt_out_capturing(): void } | null }
		)?.posthog?.opt_out_capturing()
		current = null
		vi.unstubAllGlobals()
	})

	it(`@spec ${SPEC} "In-app navigation"`, async () => {
		await start('/welcome')

		window.history.pushState(null, '', '/discovery')
		await settle()
		// A query-only change on the same screen is not a page view.
		window.history.pushState(null, '', '/discovery?artists=a1')
		await settle()
		window.history.pushState(null, '', '/dashboard')
		await settle()

		expect(pageviews()).toEqual(['/welcome', '/discovery', '/dashboard'])
	})

	it(`@spec ${SPEC} "Leaving the app"`, async () => {
		await start('/dashboard')

		window.dispatchEvent(new Event('pagehide'))

		const leaves = sent.filter((e) => e.event === '$pageleave')
		expect(leaves).toHaveLength(1)
		expect(leaves[0].properties.$pathname).toBe('/dashboard')
	})

	it(`@spec ${SPEC} "Analytics off"`, async () => {
		mockConsent.analytics = false
		await start('/welcome')

		window.history.pushState(null, '', '/discovery')
		await settle()
		window.dispatchEvent(new Event('pagehide'))

		expect(
			sent.filter((e) => e.event === '$pageview' || e.event === '$pageleave'),
		).toEqual([])
	})

	it(`@spec ${SPEC} "Campaign link with a referral code"`, async () => {
		const sut = await start(
			'/welcome?utm_source=x&utm_campaign=launch&ref=member-a',
		)

		window.history.pushState(null, '', '/discovery')
		await settle()
		// The first campaign is kept on the person: it travels as `$set_once`
		// once the person is known.
		sut.identify('user-1')

		const origin = window.location.origin
		// `$opt_in` is the SDK's record of the opt-in applied at start.
		expect(sent.map((e) => e.event)).toEqual([
			'$opt_in',
			'$pageview',
			'$pageview',
			'$identify',
		])
		expect(sent[1].properties.$current_url).toBe(`${origin}/welcome`)
		for (const event of sent) {
			expect(event.properties).toMatchObject({
				utm_source: 'x',
				utm_campaign: 'launch',
			})
			expect(JSON.stringify(event)).not.toContain('member-a')
		}
		expect(sent[3].$set_once).toMatchObject({
			$initial_utm_source: 'x',
			$initial_utm_campaign: 'launch',
		})
	})

	it(`@spec ${SPEC} "No campaign keys"`, async () => {
		await start('/discovery')

		expect(sent.length).toBeGreaterThanOrEqual(1)
		for (const event of sent) {
			// The SDK sends absent campaign keys as null, which PostHog treats
			// as not set: no campaign value is carried.
			const campaignValues = Object.entries(event.properties).filter(
				([k, v]) => k.startsWith('utm_') && v !== null,
			)
			expect(campaignValues).toEqual([])
		}
	})
})
