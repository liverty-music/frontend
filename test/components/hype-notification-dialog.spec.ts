import { DI, ILogger, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '../helpers/mock-logger'

const { HypeNotificationDialog } = await import(
	'../../src/components/hype-notification-dialog/hype-notification-dialog'
)

function createDialogWithHost() {
	const hostElement = document.createElement('div')
	document.body.appendChild(hostElement)

	const container = DI.createContainer()
	container.register(Registration.instance(ILogger, createMockLogger()))
	container.register(Registration.instance(INode, hostElement))

	const sut = container.invoke(HypeNotificationDialog)

	// Create a mock dialog element for the ref
	const mockDialog = document.createElement('dialog')
	;(mockDialog as any).showModal = vi.fn()
	;(mockDialog as any).close = vi.fn()
	;(sut as any).dialogRef = mockDialog

	return { sut, hostElement, mockDialog }
}

describe('HypeNotificationDialog', () => {
	let sut: InstanceType<typeof HypeNotificationDialog>
	let hostElement: HTMLElement
	let mockDialog: HTMLDialogElement

	beforeEach(() => {
		const result = createDialogWithHost()
		sut = result.sut
		hostElement = result.hostElement
		mockDialog = result.mockDialog
	})

	afterEach(() => {
		if (hostElement?.parentNode) {
			document.body.removeChild(hostElement)
		}
	})

	describe('active state', () => {
		it('should call showModal when active set to true', () => {
			sut.active = true
			sut.activeChanged(true)

			expect((mockDialog as any).showModal).toHaveBeenCalledTimes(1)
		})

		it('should call close when active set to false', () => {
			// First open
			sut.active = true
			sut.activeChanged(true)

			// Then close
			sut.active = false
			sut.activeChanged(false)

			expect((mockDialog as any).close).toHaveBeenCalledTimes(1)
		})
	})

	describe('once-per-session guard', () => {
		// The once-per-session guard is implemented in MyArtistsPage.onHypeSignupPrompt(),
		// not in HypeNotificationDialog itself. The dialog is a pure presentation component
		// that shows/hides based on its `active` bindable. MyArtistsPage tracks
		// `notificationDialogShown` and only sets `showNotificationDialog = true` when the
		// flag is false. After the dialog is dismissed (onDialogDismissed), the flag is set
		// to true, preventing the dialog from being shown again in the same page lifecycle.
		// This is tested in the my-artists-page.spec.ts test suite.
		it('should be a pure presentation component controlled by parent', () => {
			// Dialog does not track its own show/hide history
			expect(sut.active).toBe(false)

			sut.active = true
			sut.activeChanged(true)
			expect((mockDialog as any).showModal).toHaveBeenCalledTimes(1)

			sut.active = false
			sut.activeChanged(false)

			// Can be re-opened — guard logic is in the parent
			sut.active = true
			sut.activeChanged(true)
			expect((mockDialog as any).showModal).toHaveBeenCalledTimes(2)
		})
	})

	describe('onSignup', () => {
		it('should dispatch signup-requested event', () => {
			const handler = vi.fn()
			hostElement.addEventListener('signup-requested', handler)

			sut.onSignup()

			expect(handler).toHaveBeenCalledTimes(1)
		})
	})

	describe('onDismiss', () => {
		it('should set active to false and dispatch dialog-dismissed event', () => {
			const handler = vi.fn()
			hostElement.addEventListener('dialog-dismissed', handler)

			sut.active = true
			sut.onDismiss()

			expect(sut.active).toBe(false)
			expect(handler).toHaveBeenCalledTimes(1)
		})
	})
})
