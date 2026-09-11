import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '../../src/services/analytics-events'

// Hoisted mutable DI stubs so each test can flip opt-out / nil-config posture.
const stubs = vi.hoisted(() => ({
	config: { posthogProjectKey: 'phc_test' } as { posthogProjectKey: string },
	consent: { analytics: true },
	capture: vi.fn(),
}))

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const name = (token as { friendlyName?: string }).friendlyName ?? ''
			if (name === 'ILogger') {
				return {
					scopeTo: () => ({
						debug: vi.fn(),
						info: vi.fn(),
						warn: vi.fn(),
						error: vi.fn(),
					}),
				}
			}
			if (name === 'IAppConfig') return stubs.config
			if (name === 'IConsentService') return stubs.consent
			if (name === 'IAnalyticsService') return { capture: stubs.capture }
			return {}
		}),
	}
})

const { RpcTelemetryService } = await import(
	'../../src/services/rpc-telemetry-service'
)

describe('RpcTelemetryService', () => {
	let service: { record: typeof stubs.capture; dispose: () => void } | null =
		null

	beforeEach(() => {
		stubs.config.posthogProjectKey = 'phc_test'
		stubs.consent.analytics = true
		stubs.capture.mockClear()
	})

	afterEach(() => {
		service?.dispose()
		service = null
	})

	function build() {
		const s = new RpcTelemetryService() as unknown as NonNullable<
			typeof service
		>
		service = s
		return s
	}

	it('flushes many records as ONE aggregate event with buckets/outcomes/methods and no PII', () => {
		const s = build()
		s.record('User/Get', 30, 'ok')
		s.record('User/Get', 9000, 'deadline_exceeded')
		s.record('Artist/List', 150, 'ok')

		globalThis.dispatchEvent(new Event('pagehide'))

		expect(stubs.capture).toHaveBeenCalledTimes(1)
		const [name, props] = stubs.capture.mock.calls[0]
		expect(name).toBe(Events.RpcCallTelemetry)
		expect(props.total).toBe(3)
		expect(props.ok).toBe(2)
		expect(props.deadline_exceeded).toBe(1)
		expect(props.buckets).toEqual({ '50': 1, '250': 1, '10000': 1 })
		expect(props.methods).toEqual({
			'User/Get': [2, 1],
			'Artist/List': [1, 0],
		})
		// Only non-PII aggregate keys — no payloads, tokens, or identifiers.
		expect(Object.keys(props).sort()).toEqual([
			'buckets',
			'canceled',
			'deadline_exceeded',
			'error',
			'methods',
			'ok',
			'total',
			'window_ms',
		])
		s.dispose()
	})

	it('emits nothing when there are no records', () => {
		const s = build()
		globalThis.dispatchEvent(new Event('pagehide'))
		expect(stubs.capture).not.toHaveBeenCalled()
		s.dispose()
	})

	it('collects and emits nothing when analytics is opted out', () => {
		stubs.consent.analytics = false
		const s = build()
		s.record('User/Get', 30, 'ok')
		globalThis.dispatchEvent(new Event('pagehide'))
		expect(stubs.capture).not.toHaveBeenCalled()
		s.dispose()
	})

	it('collects nothing when analytics is unconfigured (nil-config)', () => {
		stubs.config.posthogProjectKey = ''
		const s = build()
		s.record('User/Get', 30, 'ok')
		globalThis.dispatchEvent(new Event('pagehide'))
		expect(stubs.capture).not.toHaveBeenCalled()
		s.dispose()
	})

	it('drops a window collected before a mid-window opt-out (no emit)', () => {
		const s = build()
		s.record('User/Get', 30, 'ok') // collected while enabled
		stubs.consent.analytics = false // opt out before flush
		globalThis.dispatchEvent(new Event('pagehide'))
		expect(stubs.capture).not.toHaveBeenCalled()
		s.dispose()
	})

	it('flushes on the periodic interval', () => {
		vi.useFakeTimers()
		try {
			const s = build()
			s.record('User/Get', 30, 'ok')
			vi.advanceTimersByTime(60_000)
			expect(stubs.capture).toHaveBeenCalledTimes(1)
			s.dispose()
		} finally {
			vi.useRealTimers()
		}
	})
})
