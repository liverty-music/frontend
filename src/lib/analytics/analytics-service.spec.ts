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
	opt_in_capturing: vi.fn(),
	opt_out_capturing: vi.fn(),
	set_config: vi.fn(),
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

// Minimal pub/sub modeled after IEventAggregator: subscribers keyed on
// the event class reference so `subscribe(ConsentChanged, handler)` and
// `publish(new ConsentChanged(state))` line up. The test bag below is
// reset per-test via `mockEa.reset()`.
type ChannelKey = unknown
type Handler = (event: unknown) => void
const eaChannels = new Map<ChannelKey, Set<Handler>>()
const mockEa = {
	subscribe: vi.fn((channel: ChannelKey, handler: Handler) => {
		let set = eaChannels.get(channel)
		if (!set) {
			set = new Set()
			eaChannels.set(channel, set)
		}
		set.add(handler)
		return {
			dispose: () => {
				set?.delete(handler)
			},
		}
	}),
	publish: vi.fn((event: object) => {
		const ctor = event.constructor
		const set = eaChannels.get(ctor)
		if (set) {
			for (const handler of set) handler(event)
		}
	}),
	reset: () => {
		eaChannels.clear()
		mockEa.subscribe.mockClear()
		mockEa.publish.mockClear()
	},
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
				case 'IEventAggregator':
					return mockEa
				default:
					return {}
			}
		}),
	}
})

import { ConsentChanged } from '../consent/consent-changed'
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
		posthogStub.opt_in_capturing.mockReset()
		posthogStub.opt_out_capturing.mockReset()
		posthogStub.set_config.mockReset()
		mockConfig.current = {
			posthogProjectKey: 'phc_test_key',
			posthogApiHost: 'https://eu.i.posthog.com',
		}
		mockConsent.analytics = false
		mockConsent.marketingMeasurement = false
		mockEa.reset()
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

		it('upgrades PostHog persistence to localStorage+cookie on consent grant', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			// The init() path applies pendingConsent first then flushes
			// the queue — neither happens here because mockConsent.analytics
			// stays false in beforeEach. Reset the set_config spy so the
			// assertions below only see the post-grant call.
			posthogStub.set_config.mockReset()
			posthogStub.opt_in_capturing.mockReset()

			mockEa.publish(
				new ConsentChanged({ analytics: true, marketingMeasurement: false }),
			)

			// Grant MUST opt-in (PostHog tracks the opt state internally —
			// the SDK refuses to capture while opted out regardless of
			// persistence) AND lift the persistence to localStorage+cookie
			// so distinct_id survives reload + IP capture is re-enabled.
			expect(posthogStub.opt_in_capturing).toHaveBeenCalledTimes(1)
			expect(posthogStub.set_config).toHaveBeenCalledTimes(1)
			expect(posthogStub.set_config.mock.calls[0][0]).toMatchObject({
				persistence: 'localStorage+cookie',
				ip: true,
			})
			// reset() MUST NOT fire on grant — a grant is the privacy
			// extension, not the contraction. Calling reset here would
			// drop a distinct_id the user explicitly opted to persist.
			expect(posthogStub.reset).not.toHaveBeenCalled()
		})

		// Batch 3c-1: identify replay across consent transitions.
		// UserHydrationTask fires identify before the user reaches the
		// consent screen (which is the last onboarding step). The
		// AnalyticsService must buffer the user_id and replay it once
		// consent is granted, so the user_id seen in PostHog is the real
		// one — not the anonymous bootstrap id.

		it('replays a suppressed identify when consent is later granted', async () => {
			mockConsent.analytics = false
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.identify('user-abc', { signup_month: '2026-05' })

			// Pre-grant: identify is gated, posthog.identify is NOT called.
			expect(posthogStub.identify).not.toHaveBeenCalled()

			// The consent transition flips the gate. AnalyticsService MUST
			// replay the buffered identify with the same payload so the
			// session post-consent is attributed to the real user_id
			// rather than the anonymous bootstrap id.
			//
			// In production, ConsentService mutates state BEFORE
			// publishing ConsentChanged — so when the AnalyticsService
			// handler fires, `consent.analytics` already reads true.
			// Mirror that order in the test so `replayPendingIdentifyIfAllowed`
			// reads the live (granted) state.
			posthogStub.identify.mockReset()
			mockConsent.analytics = true
			mockEa.publish(
				new ConsentChanged({ analytics: true, marketingMeasurement: false }),
			)

			expect(posthogStub.identify).toHaveBeenCalledTimes(1)
			expect(posthogStub.identify.mock.calls[0]).toEqual([
				'user-abc',
				{ signup_month: '2026-05' },
			])
		})

		it('clears the pending identify buffer on revoke so a later grant does not silently re-identify', async () => {
			mockConsent.analytics = false
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.identify('user-abc')

			// First grant: state goes false → true; production order is
			// mutate-then-publish, so the live consent flips before the
			// handler runs.
			mockConsent.analytics = true
			mockEa.publish(
				new ConsentChanged({ analytics: true, marketingMeasurement: false }),
			)
			// First grant replays — verified by the test above. Drop the
			// counter to focus on the revoke→grant cycle.
			posthogStub.identify.mockReset()

			// Revoke clears the pendingIdentify buffer.
			mockConsent.analytics = false
			mockEa.publish(
				new ConsentChanged({ analytics: false, marketingMeasurement: false }),
			)
			// A second grant must NOT re-identify the user — they would
			// need a fresh UserHydrationTask call (typically on the next
			// boot) to repopulate the buffer.
			mockConsent.analytics = true
			mockEa.publish(
				new ConsentChanged({ analytics: true, marketingMeasurement: false }),
			)

			expect(posthogStub.identify).not.toHaveBeenCalled()
		})

		it('replays a pre-init identify after the SDK loads', async () => {
			// Consent is already granted at construction time. identify
			// fired BEFORE init resolves must still reach PostHog once the
			// SDK is ready — this is the steady state for returning users
			// whose previous-boot consent grant persisted to localStorage.
			mockConsent.analytics = true
			const sut = new AnalyticsService()

			// Note: NOT awaiting _waitForInitForTests yet — identify fires
			// in the pre-init window.
			sut.identify('user-xyz')

			expect(posthogStub.identify).not.toHaveBeenCalled()

			await sut._waitForInitForTests()

			// After init: the buffered identify replays automatically as
			// part of the init callback.
			expect(posthogStub.identify).toHaveBeenCalledWith('user-xyz', undefined)
		})

		it('drops PostHog to memory persistence + reset() on consent revoke', async () => {
			// Start the user in granted state so the revoke transition has
			// somewhere to fall from. _waitForInitForTests applies the
			// pending consent inside init() (since mockConsent.analytics is
			// already true here, the init path re-applies it directly).
			mockConsent.analytics = true
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			posthogStub.set_config.mockReset()
			posthogStub.opt_out_capturing.mockReset()
			posthogStub.reset.mockReset()

			mockEa.publish(
				new ConsentChanged({ analytics: false, marketingMeasurement: false }),
			)

			// Revoke MUST opt-out the SDK, downgrade persistence to memory
			// (so the distinct_id does not survive reload), drop IP, AND
			// call reset() so any prior identification linkage is severed
			// at the SDK boundary. This is the central privacy contract
			// of the change — a revoke MUST leave the user
			// indistinguishable on the wire from a never-consenting user.
			expect(posthogStub.opt_out_capturing).toHaveBeenCalledTimes(1)
			expect(posthogStub.set_config).toHaveBeenCalledTimes(1)
			expect(posthogStub.set_config.mock.calls[0][0]).toMatchObject({
				persistence: 'memory',
				ip: false,
			})
			expect(posthogStub.reset).toHaveBeenCalledTimes(1)
		})
	})
})
