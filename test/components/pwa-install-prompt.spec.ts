import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
		return container.get(PwaInstallPrompt)
	}

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should set exit animation class on dismiss', () => {
		vi.useFakeTimers()
		sut = create(true)
		sut.canShowChanged(true)

		sut.handleDismiss()
		expect(sut.animationClass).toBe('animate-fade-slide-down')
		expect(sut.isVisible).toBe(true)

		vi.advanceTimersByTime(600)
		expect(sut.isVisible).toBe(false)
		expect(mockPwaInstall.dismiss).toHaveBeenCalled()
		vi.useRealTimers()
	})

	it('should set entrance animation when canShow becomes true', () => {
		sut = create(false)
		expect(sut.isVisible).toBe(false)

		sut.canShowChanged(true)
		expect(sut.isVisible).toBe(true)
		expect(sut.animationClass).toBe('animate-fade-slide-up')
	})

	it('should not re-enter when already visible', () => {
		sut = create(false)
		sut.canShowChanged(true)
		sut.animationClass = 'animate-fade-slide-down'

		sut.canShowChanged(true)
		// Should not override exit animation if already visible
		expect(sut.animationClass).toBe('animate-fade-slide-down')
	})

	it('should call pwaInstall.install on handleInstall', async () => {
		vi.useFakeTimers()
		sut = create(true)
		sut.canShowChanged(true)

		await sut.handleInstall()
		expect(mockPwaInstall.install).toHaveBeenCalled()
		expect(sut.animationClass).toBe('animate-fade-slide-down')
		vi.useRealTimers()
	})

	it('should hide with animation when canShow becomes false externally', () => {
		vi.useFakeTimers()
		sut = create(false)
		sut.canShowChanged(true)
		expect(sut.isVisible).toBe(true)

		sut.canShowChanged(false)
		expect(sut.animationClass).toBe('animate-fade-slide-down')
		expect(sut.isVisible).toBe(true)

		vi.advanceTimersByTime(600)
		expect(sut.isVisible).toBe(false)
		vi.useRealTimers()
	})
})
