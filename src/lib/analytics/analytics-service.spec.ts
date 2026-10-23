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
	register: vi.fn(),
	captureException: vi.fn(),
	addExceptionStep: vi.fn(),
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

import { SignedOut } from '../../services/events/signed-out'
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
		posthogStub.register.mockReset()
		posthogStub.captureException.mockReset()
		posthogStub.addExceptionStep.mockReset()
		mockConfig.current = {
			posthogProjectKey: 'phc_test_key',
			posthogApiHost: 'https://eu.i.posthog.com',
			internalTrafficUserIds: [],
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

			sut.capture(Events.ArtistSearch, { query_length: 7, result_count: 3 })
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

			sut.capture(Events.ConcertDetailViewed, {
				event_id: 'evt-1',
				artist_id: 'art-1',
				source: 'dashboard',
			})
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
			expect(posthogStub.capture.mock.calls[0][0]).toBe(
				Events.ConcertDetailViewed,
			)
			expect(posthogStub.capture.mock.calls[1][0]).toBe(Events.ArtistSearch)
		})

		it('removes the query of the current address before an event leaves the device', async () => {
			// @spec components/infrastructure/fan/web/global/analytics "Event on a referral link"
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			const [, config] = posthogStub.init.mock.calls[0]
			const beforeSend = (config as { before_send?: unknown }).before_send
			expect(beforeSend).toBeTypeOf('function')
			const origin = window.location.origin
			const sent = (
				beforeSend as (e: unknown) => {
					properties: Record<string, unknown>
				} | null
			)({
				event: 'concert_detail_viewed',
				properties: {
					$current_url: `${origin}/events/e-1?ref=member-a`,
				},
			})
			expect(sent?.properties.$current_url).toBe(`${origin}/events/e-1`)
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
			// @spec components/infrastructure/fan/web/global/analytics "Analytics off"
			mockConsent.analytics = false
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			const [, config] = posthogStub.init.mock.calls[0]
			expect(config).toMatchObject({ persistence: 'memory', ip: false })
			// Opted out: suppress capture entirely.
			expect(posthogStub.opt_out_capturing).toHaveBeenCalled()
			expect(posthogStub.opt_in_capturing).not.toHaveBeenCalled()
		})

		it('hands the reveal-timing event only to an SDK that is opted out when analytics is off', async () => {
			// @spec components/infrastructure/fan/web/route/discovery "Analytics off"
			mockConsent.analytics = false
			const sut = new AnalyticsService()

			sut.capture(Events.DiscoveryReveal, {
				entry: 'page_load',
				path: 'top',
				seed_count: 0,
				ghosts_ms: 100,
				first_name_ms: 400,
				all_names_ms: 800,
			})
			await sut._waitForInitForTests()

			// The opted-out SDK drops every capture; opt-out is applied before the
			// buffered reveal event is replayed into it.
			expect(posthogStub.opt_out_capturing).toHaveBeenCalled()
			expect(posthogStub.opt_in_capturing).not.toHaveBeenCalled()
			const revealCall = posthogStub.capture.mock.calls.findIndex(
				(c) => c[0] === Events.DiscoveryReveal,
			)
			expect(revealCall).toBeGreaterThanOrEqual(0)
			expect(
				posthogStub.opt_out_capturing.mock.invocationCallOrder[0],
			).toBeLessThan(posthogStub.capture.mock.invocationCallOrder[revealCall])
		})

		it('severs the identity link when the user signs out', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()
			sut.identify('user-1')

			mockEa.publish(new SignedOut())

			expect(posthogStub.reset).toHaveBeenCalledOnce()
			sut.dispose()
		})

		it('drops events buffered before init when the user signs out', async () => {
			const sut = new AnalyticsService()
			sut.capture(Events.ArtistSearch, { query_length: 3, result_count: 1 })

			mockEa.publish(new SignedOut())
			await sut._waitForInitForTests()

			expect(posthogStub.capture).not.toHaveBeenCalledWith(
				Events.ArtistSearch,
				expect.anything(),
			)
			sut.dispose()
		})

		it('replays the pre-init queue in idle slices, keeping the order', async () => {
			const sut = new AnalyticsService()
			sut.capture(Events.ArtistSearch, { query_length: 1, result_count: 1 })
			sut.capture(Events.ArtistSearch, { query_length: 2, result_count: 1 })
			sut.capture(Events.ArtistSearch, { query_length: 3, result_count: 1 })
			await sut._waitForInitForTests()

			// Install the idle scheduler only for the replay: one event per slice.
			const slices: ((d: { timeRemaining(): number }) => void)[] = []
			vi.stubGlobal('requestIdleCallback', (cb: (typeof slices)[number]) => {
				slices.push(cb)
			})
			try {
				posthogStub.capture.mockClear()
				;(sut as unknown as { queue: unknown[] }).queue.push(
					...[4, 5].map((n) => ({
						name: Events.ArtistSearch,
						props: { query_length: n, result_count: 1 },
					})),
				)
				;(sut as unknown as { flushQueue(): void }).flushQueue()
				// A capture during the replay queues behind it.
				sut.capture(Events.ArtistSearch, { query_length: 6, result_count: 1 })
				expect(posthogStub.capture).not.toHaveBeenCalled()

				const noTime = { timeRemaining: () => 0 }
				while (slices.length > 0) slices.shift()?.(noTime)

				const lengths = posthogStub.capture.mock.calls.map(
					(c) => (c[1] as { query_length: number }).query_length,
				)
				expect(lengths).toEqual([4, 5, 6])
				// Drained: the next capture goes straight to the SDK.
				sut.capture(Events.ArtistSearch, { query_length: 7, result_count: 1 })
				expect(posthogStub.capture).toHaveBeenCalledTimes(4)
			} finally {
				vi.unstubAllGlobals()
				sut.dispose()
			}
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
				sut.capture(Events.ArtistSearch, { query_length: i, result_count: 1 })
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

			sut.capture(Events.ArtistSearch, { query_length: 4, result_count: 2 })

			expect(posthogStub.capture).toHaveBeenCalledTimes(1)
			const [name, props] = posthogStub.capture.mock.calls[0]
			expect(name).toBe(Events.ArtistSearch)
			expect(props).toMatchObject({
				query_length: 4,
				result_count: 2,
				trace_id: '00112233445566778899aabbccddeeff',
			})
		})

		it('omits trace_id when no OTel span is active', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			setActiveSpan(undefined)

			sut.capture(Events.ArtistSearch, { query_length: 7, result_count: 3 })

			expect(posthogStub.capture).toHaveBeenCalledTimes(1)
			const [, props] = posthogStub.capture.mock.calls[0]
			expect(props).not.toHaveProperty('trace_id')
			expect(props).toMatchObject({ query_length: 7, result_count: 3 })
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

	describe('internal-traffic tagging', () => {
		it('tags an allowlisted user: internal_traffic person property + register super-property', async () => {
			mockConfig.current = {
				...mockConfig.current,
				internalTrafficUserIds: ['staff-1', 'staff-2'],
			}
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.identify('staff-2', { plan: 'pro' })

			// Person-level: identify carries internal_traffic alongside the
			// original (sanitized) properties.
			expect(posthogStub.identify).toHaveBeenCalledTimes(1)
			expect(posthogStub.identify).toHaveBeenCalledWith('staff-2', {
				plan: 'pro',
				internal_traffic: true,
			})
			// Event-level: super-property stamps every future capture.
			expect(posthogStub.register).toHaveBeenCalledTimes(1)
			expect(posthogStub.register).toHaveBeenCalledWith({
				internal_traffic: true,
			})
			// Merge contract preserved — no reset() on the identify path.
			expect(posthogStub.reset).not.toHaveBeenCalled()
		})

		it('tags an allowlisted user with no identify properties', async () => {
			mockConfig.current = {
				...mockConfig.current,
				internalTrafficUserIds: ['staff-1'],
			}
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.identify('staff-1')

			expect(posthogStub.identify).toHaveBeenCalledWith('staff-1', {
				internal_traffic: true,
			})
			expect(posthogStub.register).toHaveBeenCalledWith({
				internal_traffic: true,
			})
		})

		it('does NOT tag a non-internal user (id absent from a populated allowlist)', async () => {
			mockConfig.current = {
				...mockConfig.current,
				internalTrafficUserIds: ['staff-1', 'staff-2'],
			}
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.identify('user-123', { plan: 'pro' })

			// Normal user: identify carries only the original props, no marker.
			expect(posthogStub.identify).toHaveBeenCalledTimes(1)
			expect(posthogStub.identify).toHaveBeenCalledWith('user-123', {
				plan: 'pro',
			})
			expect(posthogStub.register).not.toHaveBeenCalled()
		})

		it('does NOT tag any user when the allowlist is empty', async () => {
			mockConfig.current = { ...mockConfig.current, internalTrafficUserIds: [] }
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.identify('user-123')

			expect(posthogStub.identify).toHaveBeenCalledWith('user-123', undefined)
			expect(posthogStub.register).not.toHaveBeenCalled()
		})

		it('treats a missing internalTrafficUserIds config field as empty (no crash, no tagging)', async () => {
			// Simulate the loader default: a `config.json` without the field is
			// normalised to an empty array, so the service must not crash and
			// must not tag anyone.
			mockConfig.current = {
				posthogProjectKey: 'phc_test_key',
				posthogApiHost: 'https://eu.i.posthog.com',
				internalTrafficUserIds: [],
			}
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			expect(() => sut.identify('user-123')).not.toThrow()
			expect(posthogStub.identify).toHaveBeenCalledWith('user-123', undefined)
			expect(posthogStub.register).not.toHaveBeenCalled()
		})

		it('tags a pre-init (buffered) identify for an internal user once the SDK loads', async () => {
			mockConfig.current = {
				...mockConfig.current,
				internalTrafficUserIds: ['staff-1'],
			}
			const sut = new AnalyticsService()

			// identify fires BEFORE init resolves — the marker must survive the
			// buffered/replay path.
			sut.identify('staff-1', { plan: 'pro' })
			expect(posthogStub.identify).not.toHaveBeenCalled()

			await sut._waitForInitForTests()

			expect(posthogStub.identify).toHaveBeenCalledTimes(1)
			expect(posthogStub.identify).toHaveBeenCalledWith('staff-1', {
				plan: 'pro',
				internal_traffic: true,
			})
			expect(posthogStub.register).toHaveBeenCalledWith({
				internal_traffic: true,
			})
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
			sut.capture(Events.ArtistSearch, {
				query_length: 5,
				result_count: 3,
				medical_condition: 'asthma',
			} as unknown as { query_length: number; result_count: number })

			expect(posthogStub.capture).toHaveBeenCalledTimes(1)
			const [, props] = posthogStub.capture.mock.calls[0]
			expect(props).not.toHaveProperty('medical_condition')
			expect(props).toMatchObject({ query_length: 5, result_count: 3 })
		})

		it('bucketizes a precise age into a coarse range', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.capture(Events.ArtistSearch, {
				query_length: 5,
				result_count: 3,
				age: 29,
			} as unknown as { query_length: number; result_count: number })

			const [, props] = posthogStub.capture.mock.calls[0]
			expect(props).not.toHaveProperty('age')
			expect(props).toMatchObject({ age_bucket: '25_34' })
		})
	})

	describe('error reports', () => {
		const ANALYTICS_SPEC = 'components/infrastructure/fan/web/global/analytics'

		type BeforeSend = (e: unknown) => {
			properties: Record<string, unknown>
		} | null

		async function beforeSend(): Promise<BeforeSend> {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()
			const [, config] = posthogStub.init.mock.calls[0]
			return (config as { before_send: BeforeSend }).before_send
		}

		it('turns exception autocapture off so every report carries the Error ID', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			const [, config] = posthogStub.init.mock.calls[0]
			expect(config).toMatchObject({ capture_exceptions: false })
		})

		it(`@spec ${ANALYTICS_SPEC} "Error report on a filtered dashboard"`, async () => {
			const send = await beforeSend()
			const origin = window.location.origin

			const sent = send({
				event: '$exception',
				properties: {
					$current_url: `${origin}/dashboard?artists=a1,a2&journey=tour&from=welcome&utm_source=x#top`,
					$initial_current_url: `${origin}/dashboard?artists=a1`,
				},
			})

			expect(sent?.properties.$current_url).toBe(
				`${origin}/dashboard?artists=a1,a2&journey=tour&from=welcome`,
			)
			// Only the current address keeps the filter.
			expect(sent?.properties.$initial_current_url).toBe(`${origin}/dashboard`)
		})

		it(`@spec ${ANALYTICS_SPEC} "Error report on a referral link"`, async () => {
			const send = await beforeSend()
			const origin = window.location.origin

			const sent = send({
				event: '$exception',
				properties: {
					$current_url: `${origin}/events/e-1?ref=member-a`,
					$initial_current_url: `${origin}/events/e-1?ref=member-a`,
					$exception_list: [{ type: 'Error', value: 'at ?ref=member-a' }],
					has_ref: true,
				},
			})

			expect(sent?.properties.$current_url).toBe(`${origin}/events/e-1`)
			expect(JSON.stringify(sent)).not.toContain(`${origin}/events/e-1?ref`)
			expect(sent?.properties.has_ref).toBe(true)
		})

		it(`@spec ${ANALYTICS_SPEC} "Other events keep the dashboard filter out"`, async () => {
			const send = await beforeSend()
			const origin = window.location.origin

			const sent = send({
				event: 'concert_detail_viewed',
				properties: { $current_url: `${origin}/dashboard?artists=a1` },
			})

			expect(sent?.properties.$current_url).toBe(`${origin}/dashboard`)
		})

		it('redacts tokens in the exception values', async () => {
			const send = await beforeSend()

			const sent = send({
				event: '$exception',
				properties: {
					$exception_list: [
						{ type: 'Error', value: 'Authorization: Bearer abc.def' },
					],
				},
			})

			expect(sent?.properties.$exception_list).toEqual([
				{ type: 'Error', value: 'Authorization: Bearer [REDACTED]' },
			])
		})

		it('returns true when the SDK accepts the report', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()
			posthogStub.captureException.mockReturnValue({ uuid: 'u-1' })
			const err = new Error('boom')

			expect(sut.captureException(err, { error_id: 'ERR-1' })).toBe(true)
			expect(posthogStub.captureException).toHaveBeenCalledWith(err, {
				error_id: 'ERR-1',
			})
		})

		it('returns false when the SDK drops the report', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()
			posthogStub.captureException.mockReturnValue(undefined)

			expect(sut.captureException(new Error('boom'), {})).toBe(false)
		})

		it('returns false and sends nothing when analytics is off', async () => {
			mockConsent.analytics = false
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			expect(sut.captureException(new Error('boom'), {})).toBe(false)
			expect(posthogStub.captureException).not.toHaveBeenCalled()
		})

		it('returns false in nil-config mode', () => {
			mockConfig.current = { posthogProjectKey: undefined }
			const sut = new AnalyticsService()

			expect(sut.captureException(new Error('boom'), {})).toBe(false)
		})

		it('returns false when the SDK throws', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()
			posthogStub.captureException.mockImplementation(() => {
				throw new Error('sdk')
			})

			expect(sut.captureException(new Error('boom'), {})).toBe(false)
		})

		it('queues a report before init, starts init at once, and calls back when accepted', async () => {
			const idle = globalThis.requestIdleCallback as ReturnType<typeof vi.fn>
			const sut = new AnalyticsService()
			posthogStub.captureException.mockReturnValue({ uuid: 'u-1' })
			const onAccepted = vi.fn()

			sut.addExceptionStep('dashboard', { type: 'navigation' })
			expect(sut.captureException(new Error('early'), {}, onAccepted)).toBe(
				false,
			)
			// Init does not wait for the idle slot the constructor scheduled.
			expect(idle).toHaveBeenCalledTimes(1)
			await vi.waitFor(() => expect(posthogStub.init).toHaveBeenCalledTimes(1))
			await sut._waitForInitForTests()

			expect(posthogStub.init).toHaveBeenCalledTimes(1)
			expect(posthogStub.addExceptionStep).toHaveBeenCalledWith('dashboard', {
				type: 'navigation',
			})
			// The step is queued first, so it is attached to the report.
			expect(
				posthogStub.addExceptionStep.mock.invocationCallOrder[0],
			).toBeLessThan(posthogStub.captureException.mock.invocationCallOrder[0])
			expect(onAccepted).toHaveBeenCalledOnce()
		})

		it('forwards exception steps after init', async () => {
			const sut = new AnalyticsService()
			await sut._waitForInitForTests()

			sut.addExceptionStep('ArtistService/Follow Internal', { type: 'rpc' })

			expect(posthogStub.addExceptionStep).toHaveBeenCalledWith(
				'ArtistService/Follow Internal',
				{ type: 'rpc' },
			)
		})
	})
})
