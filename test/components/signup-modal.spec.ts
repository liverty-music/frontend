import { I18N } from '@aurelia/i18n'
import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignupModal } from '../../src/components/signup-modal/signup-modal'
import { IAuthService } from '../../src/services/auth-service'
import { createMockI18n } from '../helpers/mock-i18n'
import { createMockLogger } from '../helpers/mock-logger'

describe('SignupModal', () => {
	let sut: SignupModal

	function create(): SignupModal {
		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		container.register(Registration.instance(I18N, createMockI18n()))
		container.register(
			Registration.instance(IAuthService, {
				signUp: vi.fn().mockResolvedValue(undefined),
			}),
		)
		container.register(SignupModal)
		const instance = container.get(SignupModal)

		// Mock dialog element
		const mockDialog = document.createElement('dialog')
		;(mockDialog as any).showModal = vi.fn()
		;(mockDialog as any).close = vi.fn()
		;(instance as any).dialogElement = mockDialog

		return instance
	}

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should open modal when active becomes true', () => {
		sut = create()
		sut.activeChanged(true)
		expect((sut as any).dialogElement.showModal).toHaveBeenCalled()
	})

	it('should close modal when active becomes false', () => {
		sut = create()
		sut.activeChanged(false)
		expect((sut as any).dialogElement.close).toHaveBeenCalled()
	})
})
