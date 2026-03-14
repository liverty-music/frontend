import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PwaInstallPrompt } from '../../src/components/pwa-install-prompt/pwa-install-prompt'
import { IPwaInstallService } from '../../src/services/pwa-install-service'
import { createMockLogger } from '../helpers/mock-logger'

describe('PwaInstallPrompt', () => {
	let sut: PwaInstallPrompt
	let mockPwaInstall: {
		canShow: boolean
		install: ReturnType<typeof vi.fn>
		dismiss: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		Object.defineProperty(window, 'matchMedia', {
			writable: true,
			value: vi.fn().mockImplementation((query: string) => ({
				matches: false,
				media: query,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			})),
		})
	})

	function create(canShow = false): PwaInstallPrompt {
		mockPwaInstall = {
			canShow,
			install: vi.fn().mockResolvedValue(undefined),
			dismiss: vi.fn(),
		}
		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		container.register(
			Registration.instance(IPwaInstallService, mockPwaInstall),
		)
		container.register(PwaInstallPrompt)
		const instance = container.get(PwaInstallPrompt)
		// Provide a mock popoverEl since there is no real DOM
		instance.popoverEl = createMockPopoverEl()
		return instance
	}

	function createMockPopoverEl(): HTMLElement {
		const el = document.createElement('div')
		el.showPopover = vi.fn()
		el.hidePopover = vi.fn()
		return el
	}

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should set exit animation state on dismiss and hide after animationend', () => {
		sut = create(true)
		sut.canShowChanged(true)

		sut.handleDismiss()
		expect(sut.animationState).toBe('fade-slide-down')
		expect(sut.isVisible).toBe(true)

		// Fire the animationend event that the component listens for
		sut.popoverEl.dispatchEvent(new Event('animationend'))
		expect(sut.isVisible).toBe(false)
		expect(mockPwaInstall.dismiss).toHaveBeenCalled()
	})

	it('should set entrance animation when canShow becomes true', () => {
		sut = create(false)
		expect(sut.isVisible).toBe(false)

		sut.canShowChanged(true)
		expect(sut.isVisible).toBe(true)
		expect(sut.animationState).toBe('fade-slide-up')
	})

	it('should not re-enter when already visible', () => {
		sut = create(false)
		sut.canShowChanged(true)
		sut.animationState = 'fade-slide-down'

		sut.canShowChanged(true)
		// Should not override exit animation if already visible
		expect(sut.animationState).toBe('fade-slide-down')
	})

	it('should call pwaInstall.install on handleInstall', async () => {
		sut = create(true)
		sut.canShowChanged(true)

		await sut.handleInstall()
		expect(mockPwaInstall.install).toHaveBeenCalled()
		expect(sut.animationState).toBe('fade-slide-down')
	})

	it('should hide with animation when canShow becomes false externally', () => {
		sut = create(false)
		sut.canShowChanged(true)
		expect(sut.isVisible).toBe(true)

		sut.canShowChanged(false)
		expect(sut.animationState).toBe('fade-slide-down')
		expect(sut.isVisible).toBe(true)

		// Fire the animationend event to complete the hide
		sut.popoverEl.dispatchEvent(new Event('animationend'))
		expect(sut.isVisible).toBe(false)
	})

	it('should hide immediately when prefers-reduced-motion is enabled', () => {
		// Override matchMedia to report reduced motion
		vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
			matches: query === '(prefers-reduced-motion: reduce)',
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}))

		sut = create(true)
		sut.canShowChanged(true)

		sut.handleDismiss()
		// With reduced motion, should hide immediately without waiting for animationend
		expect(sut.animationState).toBe('fade-slide-down')
		expect(sut.isVisible).toBe(false)
		expect(mockPwaInstall.dismiss).toHaveBeenCalled()
	})
})
