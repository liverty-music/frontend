import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let fakeCanShowFab = false
let fakeIsIos = false
let fakeShouldShowInstallBanner = false
const fakePwaInstall = {
	get canShowFab() {
		return fakeCanShowFab
	},
	get isIos() {
		return fakeIsIos
	},
	get shouldShowInstallBanner() {
		return fakeShouldShowInstallBanner
	},
	install: vi.fn().mockResolvedValue(undefined),
	confirmInstalled: vi.fn(),
}

// The host element and the router events, by DI key; every other key
// resolves to the install service stand-in.
const fakeElement = document.createElement('pwa-install-banner')
let navigationEnd: (() => void) | null = null
const fakeRouterEvents = {
	subscribe: vi.fn((event: string, handler: () => void) => {
		if (event === 'au:router:navigation-end') navigationEnd = handler
		return { dispose: vi.fn(() => (navigationEnd = null)) }
	}),
}
const byKey = new Map<unknown, unknown>()

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((key: unknown) => byKey.get(key) ?? fakePwaInstall),
		watch: () => () => {},
	}
})

import { IRouterEvents } from '@aurelia/router'
import { INode } from 'aurelia'
import {
	Events,
	IAnalyticsService,
} from '../../lib/analytics/analytics-service'
import { PwaInstallBanner } from './pwa-install-banner'

byKey.set(INode, fakeElement)
byKey.set(IRouterEvents, fakeRouterEvents)
const fakeAnalytics = { capture: vi.fn() }
byKey.set(IAnalyticsService, fakeAnalytics)

/** A stand-in for one of the element's running CSS animations. */
function fakeAnimation(animationName: string) {
	return { animationName, currentTime: 9_000 as number | null, play: vi.fn() }
}

describe('PwaInstallBanner', () => {
	beforeEach(() => {
		fakeCanShowFab = false
		fakeIsIos = false
		fakeShouldShowInstallBanner = false
		navigationEnd = null
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('binding() — install mode initialisation', () => {
		it('seeds installMode to native when canShowFab and not iOS', () => {
			fakeCanShowFab = true
			fakeIsIos = false
			const sut = new PwaInstallBanner()
			sut.binding()

			expect(sut.installMode).toBe('native')
		})

		it('seeds installMode to guide on iOS even when canShowFab is true', () => {
			fakeCanShowFab = true
			fakeIsIos = true
			const sut = new PwaInstallBanner()
			sut.binding()

			expect(sut.installMode).toBe('guide')
		})
	})

	describe('canShowFabChanged — reactive install mode', () => {
		it('switches installMode from guide to native when the prompt arrives', () => {
			const sut = new PwaInstallBanner()
			sut.binding()
			expect(sut.installMode).toBe('guide')

			fakeCanShowFab = true
			sut.canShowFabChanged()

			expect(sut.installMode).toBe('native')
		})

		it('stays in guide mode on iOS when canShowFab flips', () => {
			fakeIsIos = true
			const sut = new PwaInstallBanner()
			sut.binding()

			fakeCanShowFab = true
			sut.canShowFabChanged()

			expect(sut.installMode).toBe('guide')
		})
	})

	describe('isVisible', () => {
		it('is true when the service allows the banner', () => {
			fakeShouldShowInstallBanner = true
			const sut = new PwaInstallBanner()
			sut.binding()

			expect(sut.isVisible).toBe(true)
		})

		it('is false when the service disallows the banner', () => {
			fakeShouldShowInstallBanner = false
			const sut = new PwaInstallBanner()
			sut.binding()

			expect(sut.isVisible).toBe(false)
		})

		it('offers no dismiss', () => {
			expect('dismiss' in PwaInstallBanner.prototype).toBe(false)
		})
	})

	// @spec components/infrastructure/fan/web/global/pwa-install-banner "CTA attention cue"
	// The banner stays mounted across routes, so it restarts its counted cue
	// after every completed navigation.
	describe('attention cue on each route', () => {
		it('restarts the cue animations after a navigation completes', () => {
			const cue = [fakeAnimation('banner-cue'), fakeAnimation('banner-cue')]
			const entrance = fakeAnimation('pwa-banner-enter')
			fakeElement.getAnimations = vi.fn(() => [
				...cue,
				entrance,
			]) as unknown as typeof fakeElement.getAnimations
			const sut = new PwaInstallBanner()
			sut.attached()

			navigationEnd?.()

			expect(fakeElement.getAnimations).toHaveBeenCalledWith({ subtree: true })
			for (const animation of cue) {
				expect(animation.currentTime).toBe(0)
				expect(animation.play).toHaveBeenCalledOnce()
			}
			expect(entrance.currentTime).toBe(9_000)
			expect(entrance.play).not.toHaveBeenCalled()
		})

		it('stops listening for navigations once detached', () => {
			const sut = new PwaInstallBanner()
			sut.attached()
			const subscription = fakeRouterEvents.subscribe.mock.results[0].value

			sut.detaching()

			expect(subscription.dispose).toHaveBeenCalledOnce()
			expect(navigationEnd).toBeNull()
		})
	})

	describe('onCta', () => {
		it('installs directly in native mode', () => {
			fakeCanShowFab = true
			const sut = new PwaInstallBanner()
			sut.binding()

			sut.onCta()

			expect(fakePwaInstall.install).toHaveBeenCalledOnce()
			expect(sut.isGuideSheetOpen).toBe(false)
		})

		it('opens the guide sheet in guide mode', () => {
			fakeIsIos = true
			const sut = new PwaInstallBanner()
			sut.binding()

			sut.onCta()

			expect(fakePwaInstall.install).not.toHaveBeenCalled()
			expect(sut.isGuideSheetOpen).toBe(true)
		})
	})

	describe('usage events', () => {
		it('reports the banner shown and the accepted answer', async () => {
			// @spec components/infrastructure/fan/web/global/pwa-install-banner "Install from the banner"
			// The installed event is PwaInstallService's (pwa-install-service.spec.ts).
			fakeCanShowFab = true
			fakeShouldShowInstallBanner = true
			fakePwaInstall.install.mockResolvedValueOnce('accepted')
			const sut = new PwaInstallBanner()
			sut.binding()

			sut.attached()
			await sut.onCta()

			expect(fakeAnalytics.capture.mock.calls).toEqual([
				[Events.PwaInstallBannerShown, { install_mode: 'native' }],
				[Events.PwaInstallAnswered, { answer: 'accepted' }],
			])
		})

		it('reports the banner shown when it appears while mounted', () => {
			const sut = new PwaInstallBanner()
			sut.binding()
			sut.attached()
			expect(fakeAnalytics.capture).not.toHaveBeenCalled()

			sut.isVisibleChanged(true)

			expect(fakeAnalytics.capture).toHaveBeenCalledWith(
				Events.PwaInstallBannerShown,
				{ install_mode: 'guide' },
			)
		})

		it('reports the guide opened where the device offers no request', () => {
			fakeIsIos = true
			const sut = new PwaInstallBanner()
			sut.binding()

			sut.onCta()

			expect(fakeAnalytics.capture).toHaveBeenCalledWith(
				Events.PwaInstallAnswered,
				{ answer: 'guide_opened' },
			)
		})
	})

	describe('onConfirmInstalled', () => {
		it('confirms installation and closes the guide sheet', () => {
			fakeIsIos = true
			const sut = new PwaInstallBanner()
			sut.binding()
			sut.onCta()
			expect(sut.isGuideSheetOpen).toBe(true)

			sut.onConfirmInstalled()

			expect(fakePwaInstall.confirmInstalled).toHaveBeenCalledOnce()
			expect(sut.isGuideSheetOpen).toBe(false)
		})
	})
})
