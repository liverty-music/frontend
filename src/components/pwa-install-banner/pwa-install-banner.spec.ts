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

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => fakePwaInstall),
		watch: () => () => {},
	}
})

import { SessionKeys } from '../../constants/storage-keys'
import { PwaInstallBanner } from './pwa-install-banner'

describe('PwaInstallBanner', () => {
	beforeEach(() => {
		fakeCanShowFab = false
		fakeIsIos = false
		fakeShouldShowInstallBanner = false
		sessionStorage.clear()
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('binding() — session dismiss initialisation', () => {
		it('starts not dismissed when no sessionStorage flag is set', () => {
			const sut = new PwaInstallBanner()
			sut.binding()

			expect(sut.dismissed).toBe(false)
		})

		it('restores dismissed state from sessionStorage', () => {
			sessionStorage.setItem(SessionKeys.pwaBannerDismissed, 'true')
			const sut = new PwaInstallBanner()
			sut.binding()

			expect(sut.dismissed).toBe(true)
		})

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
		it('is true when the service allows the banner and not dismissed', () => {
			fakeShouldShowInstallBanner = true
			const sut = new PwaInstallBanner()
			sut.binding()

			expect(sut.isVisible).toBe(true)
		})

		it('is false once dismissed', () => {
			fakeShouldShowInstallBanner = true
			const sut = new PwaInstallBanner()
			sut.binding()

			sut.dismiss()

			expect(sut.isVisible).toBe(false)
		})

		it('is false when the service disallows the banner', () => {
			fakeShouldShowInstallBanner = false
			const sut = new PwaInstallBanner()
			sut.binding()

			expect(sut.isVisible).toBe(false)
		})
	})

	describe('dismiss', () => {
		it('sets dismissed and persists to sessionStorage', () => {
			const sut = new PwaInstallBanner()
			sut.binding()

			sut.dismiss()

			expect(sut.dismissed).toBe(true)
			expect(sessionStorage.getItem(SessionKeys.pwaBannerDismissed)).toBe(
				'true',
			)
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
