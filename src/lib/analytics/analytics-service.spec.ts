import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../config/app-config'
import { Events } from '../../services/analytics-events'

// ── PostHog SDK mock ───────────────────────────────────────────────────────

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

// Default-on opt-out posture: both purposes enabled unless a test opts out.
const mockConsent: { analytics: boolean; sessionReplay: boolean } = {
	analytics: true,
	sessionReplay: true,
}

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
		mockConsent.analytics = true
		mockConsent.sessionReplay = true
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

			expect(idle).not.toHaveBeenCalled()
			expect(posthogStub.init).not.toHaveBeenCalled()
		})

		it('treats capture() as a no-op when posthogProjectKey is missing', async () => {
			mockConfig.current = { posthogProjectKey: undefined }
			const sut = new AnalyticsService()

			sut.capture(Events.PageViewed, { path: '/welcome', title: 'Welcome' })
			await sut._waitForInitForTests()

			expect(posthogStub.init).not.toHaveBeenCalled()
			expect(posthogStub.capture).not.toHaveBeenCalled()
		})

		it('returns the supplied default from getFeatureFlag when disabled', () => {
			mockConfig.current = { posthogProjectKey: undefined }
			const sut = new AnalyticsService()

			expect(sut.getFeatureFlag('new-onboarding', false)).toBe(false)
			expect(sut.getFeatureFlag('experiment-bucket', 'control')).toBe('control')
		})
	})

	describe('default-on (opt-out) mode', () => {
		it('initialises with persistent storage + opt-in by default and replays buffered captures', async () => {
			const sut = new AnalyticsService()

			sut.capture(Events.PageViewed, { path: '/welcome', title: 'Welcome' })
			sut.capture(Events.ArtistSearch, { query_length: 3, result_count: 5 })

			expect(posthogStub.capture).not.toHaveBeenCalled()

			await sut._waitForInitForTests()

			// Default-on posture: localStorage+cookie persistence + IP so
			// anonymous funnels survive reloads and merge into the identified
			// profile.
			expect(posthogStub.init).toHaveBeenCalledTimes(1)
			const [key, config] = posthogStub.init.mock.calls[0]
			expect(key).toBe('phc_test_key')
			expect(config).toMatchObject({
				api_host: 'https://eu.i.posthog.com',
				persistence: 'localStorage+cookie',
				ip: true,
				autocapture: false,
				capture_pageview: false,
			})
			// opt_in_capturing is asserted because a returning user who opted
			// out then back in needs the explicit opt-in.
			expect(posthogStub.opt_in_capturing).toHaveBeenCalled()

			// Both buffered events flush in insertion order.
			expect(posthogStub.capture).toHaveBeenCalledTimes(2)
			expect(posthogStub.capture.mock.calls[0][0]).toBe(Events.PageViewed)
			expect(posthogStub.capture.mock.calls[1][0]).toBe(Events.ArtistSearch)
		})

		it('keeps session recording hard-disabled at boot even when sessionReplay is on (Decision 12)', async () => {
			mockConsent.sessionReplay = true
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			// Recording is hard-disabled in current scope per design Decision
			// 12 (masking 8.1–8.3 + sampling 8.5 deferred). The init config
			// disables it, AND any set_config touching recording must keep it
			// off, regardless of the default-on sessionReplay preference.
			const [, config] = posthogStub.init.mock.calls[0]
			expect(config).toMatchObject({ disable_session_recording: true })
			const recordingCalls = posthogStub.set_config.mock.calls.filter(
				(c) => 'disable_session_recording' in (c[0] as object),
			)
			for (const call of recordingCalls) {
				expect(call[0]).toMatchObject({ disable_session_recording: true })
			}
		})

		it('initialises opted-out (memory-only, no capture) when analytics is opted out at boot', async () => {
			mockConsent.analytics = false
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			const [, config] = posthogStub.init.mock.calls[0]
			expect(config).toMatchObject({ persistence: 'memory', ip: false })
			// Opted out: suppress capture entirely.
			expect(posthogStub.opt_out_capturing).toHaveBeenCalled()
			expect(posthogStub.opt_in_capturing).not.toHaveBeenCalled()
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

			for (let i = 0; i < 150; i++) {
				sut.capture(Events.PageViewed, { path: `/p${i}`, title: 't' })
			}

			await sut._waitForInitForTests()

			expect(posthogStub.capture).toHaveBeenCalledTimes(100)
			expect(warn).toHaveBeenCalledTimes(1)
			expect(warn.mock.calls[0][0]).toMatch(/overflow/i)
		})

		it('injects trace_id from the active OTel span into capture properties', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			setActiveSpan('00112233445566778899aabbccddeeff')

			sut.capture(Events.PageViewed, { path: '/dashboard', title: 'Dashboard' })

			expect(posthogStub.capture).toHaveBeenCalledTimes(1)
			const [name, props] = posthogStub.capture.mock.calls[0]
			expect(name).toBe(Events.PageViewed)
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
			expect(props).not.toHaveProperty('trace_id')
			expect(props).toMatchObject({ path: '/welcome', title: 'Welcome' })
		})
	})

	describe('identify — anonymous→identified merge', () => {
		it('identifies by default (not opted out) without a preceding reset() so anonymous history merges', async () => {
			mockConsent.analytics = true
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.identify('user-123', { plan: 'pro' })

			// Merge contract: identify is called and NO reset() precedes it.
			expect(posthogStub.identify).toHaveBeenCalledTimes(1)
			expect(posthogStub.identify).toHaveBeenCalledWith('user-123', {
				plan: 'pro',
			})
			expect(posthogStub.reset).not.toHaveBeenCalled()
		})

		it('suppresses identify when analytics is opted out', async () => {
			mockConsent.analytics = false
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.identify('user-123', { plan: 'pro' })

			// Opted out: no identity link may be created.
			expect(posthogStub.identify).not.toHaveBeenCalled()
		})

		it('replays a pre-init identify after the SDK loads exactly once (no reset)', async () => {
			mockConsent.analytics = true
			const sut = new AnalyticsService()

			// identify fires BEFORE init resolves.
			sut.identify('user-xyz')

			expect(posthogStub.identify).not.toHaveBeenCalled()

			await sut._waitForInitForTests()

			expect(posthogStub.identify).toHaveBeenCalledTimes(1)
			expect(posthogStub.identify).toHaveBeenCalledWith('user-xyz', undefined)
			expect(posthogStub.reset).not.toHaveBeenCalled()
		})
	})

	describe('opt-out / opt-in transitions', () => {
		it('opts out: suppresses capture, reverts to memory, drops IP, and resets()', async () => {
			mockConsent.analytics = true
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			posthogStub.set_config.mockReset()
			posthogStub.opt_out_capturing.mockReset()
			posthogStub.reset.mockReset()

			mockConsent.analytics = false
			mockEa.publish(
				new ConsentChanged({ analytics: false, sessionReplay: true }),
			)

			expect(posthogStub.opt_out_capturing).toHaveBeenCalledTimes(1)
			const memoryCall = posthogStub.set_config.mock.calls.find(
				(c) => (c[0] as { persistence?: string }).persistence === 'memory',
			)
			expect(memoryCall?.[0]).toMatchObject({
				persistence: 'memory',
				ip: false,
			})
			// reset() severs the identity link on opt-out.
			expect(posthogStub.reset).toHaveBeenCalledTimes(1)
		})

		it('re-enables: opt_in + persistent storage + identify (no reset)', async () => {
			// Start opted out, then opt back in.
			mockConsent.analytics = false
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			// A fresh identify arrives after re-enabling (UserHydrationTask is
			// re-run, or identify is called once analytics is back on).
			posthogStub.opt_in_capturing.mockReset()
			posthogStub.set_config.mockReset()
			posthogStub.identify.mockReset()
			posthogStub.reset.mockReset()

			mockConsent.analytics = true
			mockEa.publish(
				new ConsentChanged({ analytics: true, sessionReplay: true }),
			)
			sut.identify('user-abc')

			expect(posthogStub.opt_in_capturing).toHaveBeenCalledTimes(1)
			const persistCall = posthogStub.set_config.mock.calls.find(
				(c) =>
					(c[0] as { persistence?: string }).persistence ===
					'localStorage+cookie',
			)
			expect(persistCall?.[0]).toMatchObject({
				persistence: 'localStorage+cookie',
				ip: true,
			})
			expect(posthogStub.identify).toHaveBeenCalledWith('user-abc', undefined)
			// No reset() on the re-enable identify path — merge semantics.
			expect(posthogStub.reset).not.toHaveBeenCalled()
		})
	})

	describe('session replay — recording hard-disabled (Decision 12)', () => {
		// Recording is out of scope until masking (8.1–8.3) + sampling (8.5)
		// land. The sessionReplay consent toggle is tracked + persisted, but
		// must NOT start/stop actual recording yet: toggling it either
		// direction leaves recording off and never touches capture / identity.
		function assertRecordingStaysOff(): void {
			const recordingCalls = posthogStub.set_config.mock.calls.filter(
				(c) => 'disable_session_recording' in (c[0] as object),
			)
			for (const call of recordingCalls) {
				expect(call[0]).toMatchObject({ disable_session_recording: true })
			}
		}

		it('turning session replay OFF keeps recording off and leaves capture + identity untouched', async () => {
			mockConsent.analytics = true
			mockConsent.sessionReplay = true
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			posthogStub.set_config.mockReset()
			posthogStub.opt_out_capturing.mockReset()
			posthogStub.reset.mockReset()
			posthogStub.identify.mockReset()

			// User turns session replay OFF but keeps analytics ON.
			mockConsent.sessionReplay = false
			mockEa.publish(
				new ConsentChanged({ analytics: true, sessionReplay: false }),
			)

			// Recording stays disabled; analytics events + identity unaffected.
			assertRecordingStaysOff()
			expect(posthogStub.opt_out_capturing).not.toHaveBeenCalled()
			expect(posthogStub.reset).not.toHaveBeenCalled()
		})

		it('turning session replay ON does NOT start recording (deferred per Decision 12)', async () => {
			mockConsent.analytics = true
			mockConsent.sessionReplay = false
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			posthogStub.set_config.mockReset()

			// User turns session replay back ON.
			mockConsent.sessionReplay = true
			mockEa.publish(
				new ConsentChanged({ analytics: true, sessionReplay: true }),
			)

			// The preference flips, but recording must NOT actually enable —
			// no set_config call may set disable_session_recording: false.
			assertRecordingStaysOff()
		})
	})

	describe('要配慮 sensitive-property exclusion', () => {
		it('strips a sensitive-category property before emission', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			// `medical_condition` matches the sensitive denylist. Cast through
			// unknown because the typed catalogue does not declare it — the
			// filter is the last-line defence regardless of types.
			sut.capture(Events.PageViewed, {
				path: '/dashboard',
				title: 'Dashboard',
				medical_condition: 'asthma',
			} as unknown as { path: string; title: string })

			expect(posthogStub.capture).toHaveBeenCalledTimes(1)
			const [, props] = posthogStub.capture.mock.calls[0]
			expect(props).not.toHaveProperty('medical_condition')
			expect(props).toMatchObject({ path: '/dashboard', title: 'Dashboard' })
		})

		it('bucketizes a precise age into a coarse range', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.capture(Events.PageViewed, {
				path: '/profile',
				title: 'Profile',
				age: 29,
			} as unknown as { path: string; title: string })

			const [, props] = posthogStub.capture.mock.calls[0]
			expect(props).not.toHaveProperty('age')
			expect(props).toMatchObject({ age_bucket: '25_34' })
		})
	})
})
