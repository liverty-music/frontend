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

	return { sut, hostElement }
}

describe('HypeNotificationDialog', () => {
	let sut: InstanceType<typeof HypeNotificationDialog>
	let hostElement: HTMLElement

	beforeEach(() => {
		const result = createDialogWithHost()
		sut = result.sut
		hostElement = result.hostElement
	})

	afterEach(() => {
		if (hostElement?.parentNode) {
			document.body.removeChild(hostElement)
		}
	})

	describe('active state', () => {
		it('should default active to false', () => {
			expect(sut.active).toBe(false)
		})

		it('should allow active to be set to true', () => {
			sut.active = true
			expect(sut.active).toBe(true)
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
			expect(sut.active).toBe(true)

			sut.active = false

			// Can be re-opened — guard logic is in the parent
			sut.active = true
			expect(sut.active).toBe(true)
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
