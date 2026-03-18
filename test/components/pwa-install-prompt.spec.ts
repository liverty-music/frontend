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
		return container.get(PwaInstallPrompt)
	}

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should become visible when canShow becomes true', () => {
		sut = create(false)
		expect(sut.isVisible).toBe(false)

		sut.canShowChanged(true)
		expect(sut.isVisible).toBe(true)
	})

	it('should hide when canShow becomes false', () => {
		sut = create(false)
		sut.canShowChanged(true)
		expect(sut.isVisible).toBe(true)

		sut.canShowChanged(false)
		expect(sut.isVisible).toBe(false)
	})

	it('should not re-enter when already visible', () => {
		sut = create(false)
		sut.canShowChanged(true)
		sut.isVisible = true

		sut.canShowChanged(true)
		expect(sut.isVisible).toBe(true)
	})

	it('should call pwaInstall.install on handleInstall', async () => {
		sut = create(true)
		sut.canShowChanged(true)

		await sut.handleInstall()
		expect(mockPwaInstall.install).toHaveBeenCalled()
		expect(sut.isVisible).toBe(false)
	})

	it('should hide and call dismiss on handleDismiss', () => {
		sut = create(true)
		sut.canShowChanged(true)

		sut.handleDismiss()
		expect(sut.isVisible).toBe(false)
		expect(mockPwaInstall.dismiss).toHaveBeenCalled()
	})
})
