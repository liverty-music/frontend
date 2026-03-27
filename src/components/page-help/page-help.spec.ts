import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../adapter/storage/onboarding-storage', () => ({
	loadHelpSeen: vi.fn(() => false),
	saveHelpSeen: vi.fn(),
	clearAllHelpSeen: vi.fn(),
}))

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => fakeOnboarding),
		bindable: actual.bindable,
	}
})

import {
	loadHelpSeen,
	saveHelpSeen,
} from '../../adapter/storage/onboarding-storage'
import { type PageHelpPage, PageHelp } from './page-help'

const fakeOnboarding = {
	isOnboarding: true,
}

describe('PageHelp', () => {
	let sut: PageHelp

	beforeEach(() => {
		vi.mocked(loadHelpSeen).mockReturnValue(false)
		vi.mocked(saveHelpSeen).mockClear()
		fakeOnboarding.isOnboarding = true
		sut = new PageHelp()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('attached() auto-open', () => {
		it('auto-opens on discovery page during onboarding', () => {
			sut.page = 'discovery'

			sut.attached()

			expect(sut.isOpen).toBe(true)
			expect(saveHelpSeen).toHaveBeenCalledWith('discovery')
		})

		it('auto-opens on my-artists page during onboarding', () => {
			sut.page = 'my-artists'

			sut.attached()

			expect(sut.isOpen).toBe(true)
			expect(saveHelpSeen).toHaveBeenCalledWith('my-artists')
		})

		// BUG DETECTION: This test will FAIL against current code.
		// The spec defines auto-open only for discovery and my-artists.
		// Dashboard should show the ? icon only (manual open).
		it('does NOT auto-open on dashboard page', () => {
			sut.page = 'dashboard'

			sut.attached()

			expect(sut.isOpen).toBe(false)
			expect(saveHelpSeen).not.toHaveBeenCalled()
		})

		it('does NOT auto-open when help already seen', () => {
			vi.mocked(loadHelpSeen).mockReturnValue(true)
			sut.page = 'discovery'

			sut.attached()

			expect(sut.isOpen).toBe(false)
		})

		it('does NOT auto-open when not onboarding', () => {
			fakeOnboarding.isOnboarding = false
			sut.page = 'discovery'

			sut.attached()

			expect(sut.isOpen).toBe(false)
		})
	})

	describe('manual open', () => {
		it('opens on help tap regardless of page', () => {
			sut.page = 'dashboard'

			sut.onHelpTap()

			expect(sut.isOpen).toBe(true)
		})

		it('opens on help tap when not onboarding', () => {
			fakeOnboarding.isOnboarding = false
			sut.page = 'discovery'

			sut.onHelpTap()

			expect(sut.isOpen).toBe(true)
		})
	})

	describe('sheet close', () => {
		it('closes the sheet', () => {
			sut.isOpen = true

			sut.onSheetClosed()

			expect(sut.isOpen).toBe(false)
		})
	})

	// Spec: "Only active page content is rendered"
	// The switch.bind template controller guarantees DOM mutual exclusivity at the
	// framework level. These tests verify that the page bindable behaves correctly
	// at the ViewModel level, ensuring the right value is passed to the template.
	describe('page bindable', () => {
		it('defaults to discovery', () => {
			expect(sut.page).toBe('discovery')
		})

		it('accepts all valid page values', () => {
			const pages: PageHelpPage[] = ['discovery', 'dashboard', 'my-artists']
			for (const page of pages) {
				sut.page = page
				expect(sut.page).toBe(page)
			}
		})

		it('does not reset isOpen when page changes', () => {
			sut.onHelpTap()
			expect(sut.isOpen).toBe(true)

			sut.page = 'dashboard'

			expect(sut.isOpen).toBe(true)
		})
	})
})
