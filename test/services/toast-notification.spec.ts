import { DI, IEventAggregator, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from '../../src/components/toast-notification/toast'
import { ToastNotification } from '../../src/components/toast-notification/toast-notification'

function createTransitionEvent(propertyName: string): Event {
	const event = new Event('transitionend', { bubbles: true })
	Object.defineProperty(event, 'propertyName', { value: propertyName })
	return event
}

describe('ToastNotification', () => {
	let sut: ToastNotification
	let ea: IEventAggregator
	let publishToast: (event: Toast) => void
	let hostElement: HTMLElement
	let mockContainer: HTMLElement

	beforeEach(() => {
		vi.useFakeTimers()
		// jsdom does not provide matchMedia — stub it to return no-preference by default
		window.matchMedia = vi
			.fn()
			.mockReturnValue({ matches: false } as MediaQueryList)

		hostElement = document.createElement('div')

		const container = DI.createContainer()
		container.register(
			Registration.instance(INode, hostElement),
			ToastNotification,
		)
		ea = container.get(IEventAggregator)
		sut = container.get(ToastNotification)

		// Mock popover container element for Top Layer API
		mockContainer = document.createElement('div')
		;(mockContainer as any).showPopover = vi.fn()
		;(mockContainer as any).hidePopover = vi.fn()
		;(sut as any).containerElement = mockContainer

		// Subscribe by calling attaching lifecycle
		sut.attaching()
		sut.attached()

		publishToast = (event: Toast) => ea.publish(event)
	})

	afterEach(() => {
		sut.detaching()
		vi.restoreAllMocks()
	})

	it('should add toast to array and set visible immediately', () => {
		publishToast(new Toast('Test message'))

		expect(sut.toasts).toHaveLength(1)
		expect(sut.toasts[0].message).toBe('Test message')
		expect(sut.toasts[0].visible).toBe(true)
	})

	it('should auto-dismiss toast after duration', () => {
		publishToast(new Toast('Test message', 'info', { duration: 2500 }))

		expect(sut.toasts[0].visible).toBe(true)

		vi.advanceTimersByTime(2500)
		expect(sut.toasts[0].visible).toBe(false)
	})

	it('should remove toast on transitionend after dismiss', () => {
		publishToast(new Toast('Test message', 'info', { duration: 2500 }))

		expect(sut.toasts).toHaveLength(1)

		vi.advanceTimersByTime(2500)
		expect(sut.toasts).toHaveLength(1)
		expect(sut.toasts[0].visible).toBe(false)

		// Simulate transitionend — call onTransitionEnd directly with a mock event
		const toastEl = document.createElement('div')
		toastEl.dataset.toastId = '0'
		const event = createTransitionEvent('opacity')
		Object.defineProperty(event, 'target', { value: toastEl })
		;(sut as any).onTransitionEnd(event)

		expect(sut.toasts).toHaveLength(0)
	})

	it('should dismiss via handle', () => {
		const onDismiss = vi.fn()
		const toast = new Toast('Test', 'info', { onDismiss })
		publishToast(toast)

		toast.handle!.dismiss()

		expect(onDismiss).toHaveBeenCalledOnce()
		expect(sut.toasts[0].visible).toBe(false)
	})

	it('should not double-dismiss', () => {
		const onDismiss = vi.fn()
		const toast = new Toast('Test', 'info', { onDismiss })
		publishToast(toast)

		toast.handle!.dismiss()
		toast.handle!.dismiss()

		expect(onDismiss).toHaveBeenCalledOnce()
	})

	it('should handle multiple toasts with unique IDs', () => {
		publishToast(new Toast('Message 1'))
		publishToast(new Toast('Message 2'))
		publishToast(new Toast('Message 3'))

		expect(sut.toasts).toHaveLength(3)
		expect(sut.toasts[0].id).toBe(0)
		expect(sut.toasts[1].id).toBe(1)
		expect(sut.toasts[2].id).toBe(2)
	})

	it('should use default duration if not specified', () => {
		publishToast(new Toast('Test message'))

		// Default is 2500ms
		vi.advanceTimersByTime(2500)
		expect(sut.toasts[0].visible).toBe(false)
	})

	it('should hide container popover when last toast is removed', () => {
		publishToast(new Toast('Test message', 'info', { duration: 2500 }))
		vi.advanceTimersByTime(2500)

		const toastEl = document.createElement('div')
		toastEl.dataset.toastId = '0'
		const event = createTransitionEvent('opacity')
		Object.defineProperty(event, 'target', { value: toastEl })
		;(sut as any).onTransitionEnd(event)

		expect(mockContainer.hidePopover).toHaveBeenCalled()
	})
})
