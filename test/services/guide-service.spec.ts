import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOnboardingSeenFlags } from '../../src/adapter/storage/onboarding-storage'
import { IAnalyticsService } from '../../src/lib/analytics/analytics-service'
import { IAuthService } from '../../src/services/auth-service'
import { IBottomSheetTracker } from '../../src/services/bottom-sheet-tracker'
import {
	GUIDE_SEEN_AFTER_MS,
	IGuideService,
} from '../../src/services/guide-service'
import { IOnboardingService } from '../../src/services/onboarding-service'
import { IPromptCoordinator } from '../../src/services/prompt-coordinator'
import { createTestContainer } from '../helpers/create-container'
import { createMockAnalytics } from '../helpers/mock-analytics'

const CAPABILITY = 'components/infrastructure/fan/web/global/guide-moment'

function setup(opts: { isAuthenticated?: boolean } = {}) {
	const analytics = createMockAnalytics()
	const auth = { isAuthenticated: opts.isAuthenticated ?? false }
	const onboarding = { isOnboarding: true }
	const container = createTestContainer(
		Registration.instance(IAnalyticsService, analytics),
		Registration.instance(IAuthService, auth),
		Registration.instance(IOnboardingService, onboarding),
	)
	const sut = container.get(IGuideService)
	const sheets = container.get(IBottomSheetTracker)
	const prompts = container.get(IPromptCoordinator)
	return { sut, sheets, prompts, analytics, auth }
}

function tapOn(el: Element) {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe(CAPABILITY, () => {
	beforeEach(() => {
		localStorage.clear()
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		document.body.innerHTML = ''
	})

	describe('One guide moment at a time, never over another interruption', () => {
		it('waits behind the home-area sheet and appears once it closes', () => {
			// @spec components/infrastructure/fan/web/global/guide-moment "Home-area sheet open"
			const { sut, sheets } = setup()
			const sheet = {}
			sheets.opened(sheet)

			sut.request('myArtists.hype')
			expect(sut.current).toBeNull()

			sheets.closed(sheet)
			expect(sut.current).toBe('myArtists.hype')

			// Once: another close does not bring it back after it ended.
			sut.dismiss('myArtists.hype', 'other_tap')
			sheets.opened(sheet)
			sheets.closed(sheet)
			expect(sut.current).toBeNull()
		})

		it('shows nothing while a dialog is open over the concert sheet', () => {
			// @spec components/infrastructure/fan/web/global/guide-moment "A dialog over the concert sheet"
			const { sut, sheets } = setup()
			const concertSheet = {}
			sheets.opened(concertSheet)
			const dialog = document.createElement('dialog')
			document.body.append(dialog)
			// jsdom has no top layer: report the dialog as the open modal one.
			const query = document.querySelector.bind(document)
			vi.spyOn(document, 'querySelector').mockImplementation((sel: string) =>
				sel === 'dialog:modal' ? dialog : query(sel),
			)

			sut.request('sheet.notify')
			expect(sut.current).toBeNull()
		})

		it('shows the concert sheet moment inside the open concert sheet', () => {
			// @spec components/infrastructure/fan/web/global/guide-moment "Inside the concert sheet"
			const { sut, sheets } = setup()
			sheets.opened({})

			sut.request('sheet.notify')
			expect(sut.current).toBe('sheet.notify')
		})

		it('ends a shown moment when a sheet opens over it', () => {
			// @spec components/infrastructure/fan/web/global/guide-moment "A sheet opens over a shown moment"
			const { sut, sheets, analytics } = setup()
			sut.request('discovery.swap')
			const sheet = {}
			sheets.opened(sheet)

			expect(sut.current).toBeNull()
			expect(analytics.capture).toHaveBeenCalledWith('guide.dismissed', {
				moment: 'discovery.swap',
				is_guest: true,
				is_onboarding: true,
				reason: 'blocked',
			})

			// Shown for less than 3 seconds: not seen, so it comes back once.
			sheets.closed(sheet)
			expect(sut.current).toBe('discovery.swap')
		})

		it('does not bring back a moment that was seen before a sheet opened over it', () => {
			const { sut, sheets } = setup()
			sut.request('discovery.swap')
			vi.advanceTimersByTime(GUIDE_SEEN_AFTER_MS)
			const sheet = {}
			sheets.opened(sheet)
			sheets.closed(sheet)
			expect(sut.current).toBeNull()
		})

		it('drops a moment a sheet ended when the fan leaves the screen', () => {
			const { sut, sheets } = setup()
			sut.request('discovery.swap')
			const sheet = {}
			sheets.opened(sheet)
			sut.dismiss('discovery.swap', 'route_leave')
			sheets.closed(sheet)
			expect(sut.current).toBeNull()
		})

		it('keeps the shown moment when another screen requests one', () => {
			const { sut } = setup()
			sut.request('discovery.swap')
			sut.request('myArtists.hype')
			expect(sut.current).toBe('discovery.swap')
		})

		it('waits while the post-signup surface is open', () => {
			const { sut, prompts } = setup()
			prompts.isPostSignupSurfaceOpen = true
			sut.request('discovery.follow')
			expect(sut.current).toBeNull()
			prompts.isPostSignupSurfaceOpen = false
			expect(sut.current).toBe('discovery.follow')
		})
	})

	describe('A guide moment ends when the fan acts or moves on', () => {
		it('ends on a tap outside the target', () => {
			// @spec components/infrastructure/fan/web/global/guide-moment "Tap elsewhere"
			const { sut } = setup()
			const target = document.createElement('button')
			const elsewhere = document.createElement('div')
			document.body.append(target, elsewhere)
			sut.request('discovery.swap')
			sut.setTarget('discovery.swap', target)

			tapOn(target)
			expect(sut.current).toBe('discovery.swap')

			tapOn(elsewhere)
			expect(sut.current).toBeNull()
		})

		it('ends when the fan leaves the screen', () => {
			// @spec components/infrastructure/fan/web/global/guide-moment "Leaving the screen"
			const { sut, analytics } = setup()
			sut.request('discovery.follow')
			sut.dismiss('discovery.follow', 'route_leave')

			expect(sut.current).toBeNull()
			expect(analytics.capture).toHaveBeenLastCalledWith(
				'guide.dismissed',
				expect.objectContaining({ reason: 'route_leave' }),
			)
		})

		it('drops a request still waiting when the screen is left', () => {
			const { sut, sheets } = setup()
			const sheet = {}
			sheets.opened(sheet)
			sut.request('myArtists.hype')
			sut.dismiss('myArtists.hype', 'route_leave')
			sheets.closed(sheet)
			expect(sut.current).toBeNull()
		})
	})

	describe('Each guide moment is shown once per device and survives sign-up', () => {
		it('counts as seen after 3 seconds on screen', () => {
			// @spec components/infrastructure/fan/web/global/guide-moment "Seen after 3 seconds"
			const { sut } = setup()
			sut.request('discovery.follow')
			vi.advanceTimersByTime(GUIDE_SEEN_AFTER_MS)
			sut.dismiss('discovery.follow', 'route_leave')

			sut.request('discovery.follow')
			expect(sut.current).toBeNull()
		})

		it('does not count as seen when left within a second', () => {
			// @spec components/infrastructure/fan/web/global/guide-moment "Left at once"
			const { sut } = setup()
			sut.request('discovery.follow')
			vi.advanceTimersByTime(900)
			sut.dismiss('discovery.follow', 'route_leave')

			sut.request('discovery.follow')
			expect(sut.current).toBe('discovery.follow')
		})

		it('keeps seen moments through the sign-up reset', () => {
			// @spec components/infrastructure/fan/web/global/guide-moment "Sign-up keeps seen moments"
			const { sut } = setup()
			sut.request('discovery.follow')
			sut.acted('discovery.follow')

			clearOnboardingSeenFlags()

			const signedIn = setup({ isAuthenticated: true })
			signedIn.sut.request('discovery.follow')
			expect(signedIn.sut.current).toBeNull()
		})

		it('counts as seen when the fan uses the target', () => {
			const { sut } = setup()
			sut.request('discovery.swap')
			sut.acted('discovery.swap')
			expect(sut.current).toBeNull()
			sut.request('discovery.swap')
			expect(sut.current).toBeNull()
		})

		it('replays a seen moment', () => {
			const { sut } = setup()
			sut.request('myArtists.hype')
			sut.acted('myArtists.hype')

			sut.replay('myArtists.hype')
			expect(sut.current).toBe('myArtists.hype')
		})
	})

	describe('Guide moments are reported', () => {
		it('reports the moment shown and used', () => {
			// @spec components/infrastructure/fan/web/global/guide-moment "Moment used"
			const { sut, analytics } = setup({ isAuthenticated: true })
			sut.request('discovery.swap')
			sut.acted('discovery.swap')

			const props = {
				moment: 'discovery.swap',
				is_guest: false,
				is_onboarding: true,
			}
			expect(analytics.capture.mock.calls).toEqual([
				['guide.shown', props],
				['guide.acted', props],
			])
		})

		it('sends nothing for a moment waiting behind a blocker', () => {
			const { sut, sheets, analytics } = setup()
			sheets.opened({})
			sut.request('myArtists.hype')
			expect(analytics.capture).not.toHaveBeenCalled()
		})
	})
})
