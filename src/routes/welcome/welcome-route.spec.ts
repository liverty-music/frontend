import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveEvent } from '../../components/live-highway/live-event'

// ── Dependency mocks ──────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		// runTasks is called inside the View Transition path; make it a no-op spy.
		runTasks: vi.fn(),
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IAuthService: { isAuthenticated: false, ready: Promise.resolve() },
				IUserStore: { currentLanguage: 'ja', clearGuest: vi.fn() },
				IFollowStore: { clearGuest: vi.fn() },
				IRouter: { load: vi.fn() },
				IEventAggregator: { publish: vi.fn() },
				I18N: { getLocale: () => 'ja', tr: (k: string) => k },
				IConcertStore: { listByArtists: vi.fn(), toDateGroups: vi.fn() },
				INode: document.createElement('div'),
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		bindable: actual.bindable,
	}
})

// Reduced motion off by default; individual tests override.
vi.mock('../../util/prefers-reduced-motion', () => ({
	prefersReducedMotion: vi.fn(() => false),
}))

import { resolve, runTasks } from 'aurelia'
import { prefersReducedMotion } from '../../util/prefers-reduced-motion'
import { WelcomeRoute } from './welcome-route'

const reducedMotionMock = vi.mocked(prefersReducedMotion)

function makeEvent(id: string): LiveEvent {
	return { id, artistName: 'A', artistId: id } as LiveEvent
}

describe('WelcomeRoute — guided demo state machine', () => {
	let sut: WelcomeRoute

	beforeEach(() => {
		vi.clearAllMocks()
		reducedMotionMock.mockReturnValue(false)
		vi.mocked(runTasks).mockReset()
		// No View Transitions in jsdom → the instant-swap path is exercised.
		;(
			document as unknown as { startViewTransition?: unknown }
		).startViewTransition = undefined
		sut = new WelcomeRoute()
	})

	it('starts on the notification phase', () => {
		expect(sut.demoPhase).toBe('notification')
		expect(sut.coachActive).toBe(false)
	})

	it('plays the exit first, then swaps in the timetable (sequential)', async () => {
		vi.useFakeTimers()
		try {
			sut.onNotificationTap()
			// The notification is dismissing — still on the notification phase.
			expect(sut.demoExiting).toBe(true)
			expect(sut.demoPhase).toBe('notification')
			await vi.advanceTimersByTimeAsync(380)
			expect(sut.demoExiting).toBe(false)
			expect(sut.demoPhase).toBe('timetable')
		} finally {
			vi.useRealTimers()
		}
	})

	// @spec components/infrastructure/fan/web/global/coach-mark "Coach mark appears after 5 seconds"
	it('activates the coach-mark a delay after the timetable appears', async () => {
		vi.useFakeTimers()
		try {
			sut.onNotificationTap()
			await vi.advanceTimersByTimeAsync(380) // exit → timetable
			// Not shown immediately — a self-directed visitor gets time to tap first.
			expect(sut.coachActive).toBe(false)
			await vi.advanceTimersByTimeAsync(4999)
			expect(sut.coachActive).toBe(false)
			await vi.advanceTimersByTimeAsync(1) // 5 s of interactive timetable
			expect(sut.coachActive).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	// @spec components/infrastructure/fan/web/global/coach-mark "A card tap before 5 seconds cancels the coach mark"
	it('a card tap before the coach delay cancels the coach-mark', async () => {
		vi.useFakeTimers()
		try {
			// biome-ignore lint/suspicious/noExplicitAny: minimal sheet stub for the test
			sut.detailSheet = { open: vi.fn() } as any
			sut.onNotificationTap()
			await vi.advanceTimersByTimeAsync(380) // exit → timetable, coach timer running
			const event = new CustomEvent('event-selected', {
				detail: { event: makeEvent('c1') },
			})
			sut.onEventSelected(event as CustomEvent<{ event: LiveEvent }>)
			await vi.advanceTimersByTimeAsync(5000)
			expect(sut.coachActive).toBe(false)
		} finally {
			vi.useRealTimers()
		}
	})

	it('opens the detail sheet and dismisses the coach on card selection', () => {
		const open = vi.fn()
		// biome-ignore lint/suspicious/noExplicitAny: minimal sheet stub for the test
		sut.detailSheet = { open } as any
		sut.coachActive = true
		const event = new CustomEvent('event-selected', {
			detail: { event: makeEvent('c1') },
		})
		sut.onEventSelected(event as CustomEvent<{ event: LiveEvent }>)
		expect(open).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'c1' }),
			'page',
			false,
		)
		expect(sut.coachActive).toBe(false)
	})

	it('coach tap and dismiss both clear coachActive', () => {
		sut.coachActive = true
		sut.onCoachTap()
		expect(sut.coachActive).toBe(false)
		sut.coachActive = true
		sut.onCoachDismiss()
		expect(sut.coachActive).toBe(false)
	})

	// @spec components/infrastructure/fan/web/global/coach-mark "Welcome coach mark deactivates on tap or leaving"
	describe('coach mark goes from active to inactive, leaving onboarding alone', () => {
		const resolved = () =>
			vi
				.mocked(resolve)
				.mock.calls.map(
					([token]) => (token as { friendlyName?: string }).friendlyName,
				)

		async function activeCoach(): Promise<void> {
			sut.onNotificationTap()
			await vi.advanceTimersByTimeAsync(380 + 5000)
			expect(sut.coachActive).toBe(true)
		}

		beforeEach(() => {
			vi.useFakeTimers()
			localStorage.setItem('onboardingComplete', 'false')
		})

		afterEach(() => {
			vi.useRealTimers()
			localStorage.removeItem('onboardingComplete')
		})

		it.each([
			['the highlighted card is tapped', () => sut.onCoachTap()],
			['the visitor taps outside it', () => sut.onCoachDismiss()],
			['the visitor leaves Welcome', () => sut.detaching()],
		])('when %s', async (_, act) => {
			await activeCoach()
			act()
			expect(sut.coachActive).toBe(false)
			// It never comes back on this visit.
			await vi.advanceTimersByTimeAsync(10_000)
			expect(sut.coachActive).toBe(false)
			// Welcome never reaches for onboarding state, and the stored flag is untouched.
			expect(resolved()).toContain('IUserStore')
			expect(resolved()).not.toContain('IOnboardingService')
			expect(localStorage.getItem('onboardingComplete')).toBe('false')
		})
	})
})

describe('WelcomeRoute — no-preview fallback + detach', () => {
	let sut: WelcomeRoute

	beforeEach(() => {
		vi.clearAllMocks()
		reducedMotionMock.mockReturnValue(false)
		sut = new WelcomeRoute()
	})

	it('dateGroups starts empty so the demo is not rendered', () => {
		expect(sut.dateGroups).toHaveLength(0)
	})

	it('aborts the in-flight load on detach', () => {
		const ac = new AbortController()
		// biome-ignore lint/suspicious/noExplicitAny: accessing private for test
		;(sut as any).abortController = ac
		const spy = vi.spyOn(ac, 'abort')
		sut.detaching()
		expect(spy).toHaveBeenCalled()
	})
})
