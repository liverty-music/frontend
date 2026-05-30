import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../config/app-config'
import { Events } from '../../services/analytics-events'

// ── PostHog SDK mock ───────────────────────────────────────────────────────
//
// `import('posthog-js')` is awaited inside AnalyticsService.init(). Vitest
// resolves the dynamic import against this `vi.mock` so no real SDK code
// (and no network) runs. We expose the captured init args + a per-test
// resettable spy bag via the module's `default` export, matching the
// shape AnalyticsService consumes (`module.default.init/capture/...`).

const posthogStub = {
	init: vi.fn(),
	capture: vi.fn(),
	identify: vi.fn(),
	reset: vi.fn(),
	getFeatureFlag: vi.fn(),
}

vi.mock('posthog-js', () => ({
	default: posthogStub,
}))

// ── OpenTelemetry mock ─────────────────────────────────────────────────────
//
// AnalyticsService calls `trace.getActiveSpan()` at every dispatch. The
// span return value is controlled per-test via `setActiveSpanForTest()`
// so we can cover the "trace_id injected" and "trace_id omitted" branches
// without standing up a real tracer provider.

let activeSpan:
	| {
			spanContext: () => { traceId: string; spanId: string; traceFlags: number }
	  }
	| undefined

function setActiveSpan(traceId: string | undefined): void {
	activeSpan =
		traceId === undefined
			? undefined
			: {
					spanContext: () => ({ traceId, spanId: 'abc', traceFlags: 1 }),
				}
}

vi.mock('@opentelemetry/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@opentelemetry/api')>()
	return {
		...actual,
		trace: {
			...actual.trace,
			getActiveSpan: () => activeSpan,
		},
	}
})

// ── Aurelia DI mock ────────────────────────────────────────────────────────
//
// Same `friendlyName`-keyed resolver stub the existing `concert-service`
// spec uses. `config` and `consent` are mutated per-test via the
// references captured below, so the SUT sees the runtime values selected
// by the test without re-instantiating the mock map.

const mockLogger = {
	scopeTo: () => ({
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}

const mockConfig: { current: Partial<AppConfig> } = {
	current: { posthogProjectKey: 'phc_test_key' },
}

const mockConsent: { analytics: boolean; marketingMeasurement: boolean } = {
	analytics: false,
	marketingMeasurement: false,
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const tokenAny = token as { friendlyName?: string }
			switch (tokenAny.friendlyName) {
				case 'ILogger':
					return mockLogger
				case 'IAppConfig':
					return mockConfig.current
				case 'IConsentService':
					return mockConsent
				default:
					return {}
			}
		}),
	}
})

import { AnalyticsService } from './analytics-service'

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Suppress `requestIdleCallback` so the constructor doesn't fire init
 * before the test arranges its preconditions. Tests that want to drive
 * init call `_waitForInitForTests()` explicitly.
 */
function stubIdleCallback(): void {
	Object.defineProperty(globalThis, 'requestIdleCallback', {
		configurable: true,
		writable: true,
		value: vi.fn(),
	})
}

function clearIdleCallback(): void {
	const g = globalThis as { requestIdleCallback?: unknown }
	delete g.requestIdleCallback
}

describe('AnalyticsService', () => {
	beforeEach(() => {
		posthogStub.init.mockReset()
		posthogStub.capture.mockReset()
		posthogStub.identify.mockReset()
		posthogStub.reset.mockReset()
		posthogStub.getFeatureFlag.mockReset()
		mockConfig.current = {
			posthogProjectKey: 'phc_test_key',
			posthogApiHost: 'https://eu.i.posthog.com',
		}
		mockConsent.analytics = false
		mockConsent.marketingMeasurement = false
		setActiveSpan(undefined)
		stubIdleCallback()
	})

	afterEach(() => {
		clearIdleCallback()
		vi.restoreAllMocks()
	})

	describe('nil-config (disabled) mode', () => {
		it('does not schedule PostHog init when posthogProjectKey is missing', () => {
			mockConfig.current = { posthogProjectKey: undefined }
			const idle = globalThis.requestIdleCallback as ReturnType<typeof vi.fn>

			new AnalyticsService()

			// scheduleInit() short-circuits before requestIdleCallback —
			// proving the SDK dynamic import is never queued in nil-config
			// mode. This is what mirrors the backend's `client == nil`
			// posture: no key → no network → no surprises.
			expect(idle).not.toHaveBeenCalled()
			expect(posthogStub.init).not.toHaveBeenCalled()
		})

		it('treats capture() as a no-op when posthogProjectKey is missing', async () => {
			mockConfig.current = { posthogProjectKey: undefined }
			const sut = new AnalyticsService()

			sut.capture(Events.PageViewed, { path: '/welcome', title: 'Welcome' })
			await sut._waitForInitForTests()

			// No init AND no buffered events: a stuck CMS / missing
			// ConfigMap deployment MUST NOT silently buffer 100s of
			// events in memory.
			expect(posthogStub.init).not.toHaveBeenCalled()
			expect(posthogStub.capture).not.toHaveBeenCalled()
		})

		it('returns the supplied default from getFeatureFlag when disabled', () => {
			mockConfig.current = { posthogProjectKey: undefined }
			const sut = new AnalyticsService()

			// Defaulting is what lets route guards stay synchronous and
			// fail-closed: without a key, every gate decides "off"
			// regardless of what the production project would say.
			expect(sut.getFeatureFlag('new-onboarding', false)).toBe(false)
			expect(sut.getFeatureFlag('experiment-bucket', 'control')).toBe('control')
		})
	})

	describe('enabled mode', () => {
		it('buffers capture() calls before init and replays them after init resolves', async () => {
			const sut = new AnalyticsService()

			sut.capture(Events.PageViewed, { path: '/welcome', title: 'Welcome' })
			sut.capture(Events.ArtistSearch, {
				query_length: 3,
				result_count: 5,
			})

			// Neither event has hit posthog.capture yet — they're sitting
			// in the pre-init queue.
			expect(posthogStub.capture).not.toHaveBeenCalled()

			await sut._waitForInitForTests()

			// init was called with the EU host + the privacy-default config
			// the OpenSpec change pins for the pre-consent posture.
			expect(posthogStub.init).toHaveBeenCalledTimes(1)
			const [key, config] = posthogStub.init.mock.calls[0]
			expect(key).toBe('phc_test_key')
			expect(config).toMatchObject({
				api_host: 'https://eu.i.posthog.com',
				persistence: 'memory',
				ip: false,
				autocapture: false,
				capture_pageview: false,
				disable_session_recording: true,
			})

			// Both buffered events flush in insertion order.
			expect(posthogStub.capture).toHaveBeenCalledTimes(2)
			expect(posthogStub.capture.mock.calls[0][0]).toBe(Events.PageViewed)
			expect(posthogStub.capture.mock.calls[1][0]).toBe(Events.ArtistSearch)
		})

		it('warns and drops excess events when the pre-init queue overflows 100 entries', async () => {
			const warn = vi.fn()
			const scopedLogger = {
				trace: vi.fn(),
				debug: vi.fn(),
				info: vi.fn(),
				warn,
				error: vi.fn(),
			}
			mockLogger.scopeTo = () => scopedLogger

			const sut = new AnalyticsService()

			// Push 150 events while the SDK is still queued — 100 fit, 50
			// MUST be dropped (and ONE warn emitted, not 50).
			for (let i = 0; i < 150; i++) {
				sut.capture(Events.PageViewed, {
					path: `/p${i}`,
					title: 't',
				})
			}

			await sut._waitForInitForTests()

			// Only the first 100 are replayed.
			expect(posthogStub.capture).toHaveBeenCalledTimes(100)
			// And the overflow warn fires exactly once — a stuck init
			// must NOT flood the log sink with one warn per dropped event.
			expect(warn).toHaveBeenCalledTimes(1)
			expect(warn.mock.calls[0][0]).toMatch(/overflow/i)
		})

		it('skips PostHog.identify when consent.analytics is false', async () => {
			mockConsent.analytics = false
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.identify('user-123', { plan: 'pro' })

			// Hard gate: PostHog MUST NOT see the real user id until
			// the consent screen flips `consent.analytics` to true.
			// This is the central privacy contract of the change.
			expect(posthogStub.identify).not.toHaveBeenCalled()
		})

		it('injects trace_id from the active OTel span into capture properties', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			setActiveSpan('00112233445566778899aabbccddeeff')

			sut.capture(Events.PageViewed, { path: '/dashboard', title: 'Dashboard' })

			expect(posthogStub.capture).toHaveBeenCalledTimes(1)
			const [name, props] = posthogStub.capture.mock.calls[0]
			expect(name).toBe(Events.PageViewed)
			// trace_id MUST be the active span's traceId so paired FE/BE
			// events can be joined in PostHog dashboards. The original
			// properties pass through unchanged.
			expect(props).toMatchObject({
				path: '/dashboard',
				title: 'Dashboard',
				trace_id: '00112233445566778899aabbccddeeff',
			})
		})

		it('omits trace_id when no OTel span is active', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			setActiveSpan(undefined)

			sut.capture(Events.PageViewed, { path: '/welcome', title: 'Welcome' })

			expect(posthogStub.capture).toHaveBeenCalledTimes(1)
			const [, props] = posthogStub.capture.mock.calls[0]
			// No span → no trace_id key in the payload at all (not even
			// an empty string). This keeps standalone UI events
			// distinguishable from RPC-correlated ones in PostHog.
			expect(props).not.toHaveProperty('trace_id')
			expect(props).toMatchObject({
				path: '/welcome',
				title: 'Welcome',
			})
		})
	})
})
