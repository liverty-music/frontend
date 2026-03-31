import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let fakeCanShowFab = false
let fakeIsIos = false
const fakePwaInstall = {
	get canShowFab() {
		return fakeCanShowFab
	},
	get isIos() {
		return fakeIsIos
	},
	install: vi.fn().mockResolvedValue(undefined),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => fakePwaInstall),
		watch: () => () => {},
	}
})

import { PwaInstallFab } from './pwa-install-fab'

describe('PwaInstallFab', () => {
	let sut: PwaInstallFab

	beforeEach(() => {
		fakeCanShowFab = false
		fakeIsIos = false
		vi.clearAllMocks()
		sut = new PwaInstallFab()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('binding() — initial state sync', () => {
		it('sets isVisible to true when canShowFab is already true at binding time', () => {
			fakeCanShowFab = true
			const instance = new PwaInstallFab()
			instance.binding()

			expect(instance.isVisible).toBe(true)
		})

		it('leaves isVisible false when canShowFab is false at binding time', () => {
			fakeCanShowFab = false
			const instance = new PwaInstallFab()
			instance.binding()

			expect(instance.isVisible).toBe(false)
		})
	})

	describe('canShowFabChanged', () => {
		it('sets isVisible to true when canShowFab becomes true', () => {
			sut.canShowFabChanged(true)

			expect(sut.isVisible).toBe(true)
		})

		it('sets isVisible to false when canShowFab becomes false', () => {
			sut.canShowFabChanged(true)
			sut.canShowFabChanged(false)

			expect(sut.isVisible).toBe(false)
		})
	})

	describe('isIos field', () => {
		it('captures pwaInstall.isIos at construction time', () => {
			fakeIsIos = true
			const instance = new PwaInstallFab()

			expect(instance.isIos).toBe(true)
		})

		it('is false when pwaInstall.isIos is false at construction', () => {
			fakeIsIos = false
			const instance = new PwaInstallFab()

			expect(instance.isIos).toBe(false)
		})
	})

	describe('handleTap', () => {
		it('opens iOS sheet when isIos is true', () => {
			// isIos is captured at construction time — create instance after setting flag
			fakeIsIos = true
			const ios = new PwaInstallFab()

			ios.handleTap()

			expect(ios.isSheetOpen).toBe(true)
			expect(fakePwaInstall.install).not.toHaveBeenCalled()
		})

		it('calls pwaInstall.install on Android/Chrome', () => {
			fakeIsIos = false

			sut.handleTap()

			expect(fakePwaInstall.install).toHaveBeenCalledOnce()
			expect(sut.isSheetOpen).toBe(false)
		})
	})

	describe('closeSheet', () => {
		it('closes the iOS sheet', () => {
			fakeIsIos = true
			const ios = new PwaInstallFab()
			ios.handleTap()
			expect(ios.isSheetOpen).toBe(true)

			ios.closeSheet()

			expect(ios.isSheetOpen).toBe(false)
		})
	})
})
