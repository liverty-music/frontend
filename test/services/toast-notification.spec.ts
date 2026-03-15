import { DI, IEventAggregator, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from '../../src/components/toast-notification/toast'
import { ToastNotification } from '../../src/components/toast-notification/toast-notification'

// jsdom does not provide ToggleEvent — polyfill for tests
if (typeof globalThis.ToggleEvent === 'undefined') {
	;(globalThis as any).ToggleEvent = class ToggleEvent extends Event {
		public readonly newState: string
		public readonly oldState: string
		constructor(type: string, init: { newState: string; oldState: string }) {
			super(type)
			this.newState = init.newState
			this.oldState = init.oldState
		}
	}
}

function createToggleEvent(newState: 'open' | 'closed'): ToggleEvent {
	return new ToggleEvent('toggle', {
		newState,
		oldState: newState === 'closed' ? 'open' : 'closed',
	})
}

function createMockToastElement(): HTMLElement {
	const el = document.createElement('div')
	;(el as any).showPopover = vi.fn()
	;(el as any).hidePopover = vi.fn()
	return el
}

describe('ToastNotification', () => {
	let sut: ToastNotification
	let ea: IEventAggregator
	let publishToast: (event: Toast) => void
	let hostElement: HTMLElement
	let mockContainer: HTMLElement

	beforeEach(() => {
		vi.useFakeTimers()

		hostElement = document.createElement('div')

		const container = DI.createContainer()
		container.register(
			Registration.instance(INode, hostElement),
			ToastNotification,
		)
		ea = container.get(IEventAggregator)
		sut = container.get(ToastNotification)

		// Container element that holds toast children
		mockContainer = document.createElement('div')
		;(sut as any).containerElement = mockContainer

		sut.attaching()

		publishToast = (event: Toast) => ea.publish(event)
	})

	afterEach(() => {
		sut.detaching()
		vi.restoreAllMocks()
	})

	/** Insert a mock popover element into the container to simulate Aurelia repeat.for rendering. */
	function insertMockElement(toastId: number): HTMLElement {
		const el = createMockToastElement()
		el.dataset.toastId = String(toastId)
		mockContainer.appendChild(el)
		return el
	}

	it('should add toast to array on publish', () => {
		publishToast(new Toast('Test message'))

		expect(sut.toasts).toHaveLength(1)
		expect(sut.toasts[0].message).toBe('Test message')
	})

	it('should call showPopover after microtask flush', async () => {
		publishToast(new Toast('Test message'))
		const el = insertMockElement(0)

		// Flush the queueMicrotask
		await Promise.resolve()

		expect(el.showPopover).toHaveBeenCalledOnce()
	})

	it('should auto-dismiss toast after duration', () => {
		publishToast(new Toast('Test message', 'info', { duration: 2500 }))
		insertMockElement(0)

		expect(sut.toasts[0].dismissed).toBe(false)

		vi.advanceTimersByTime(2500)
		expect(sut.toasts[0].dismissed).toBe(true)
	})

	it('should remove toast on toggle event after hidePopover', () => {
		publishToast(new Toast('Test message', 'info', { duration: 2500 }))
		insertMockElement(0)

		expect(sut.toasts).toHaveLength(1)

		vi.advanceTimersByTime(2500)
		// Toast is dismissed but still in array (awaiting toggle)
		expect(sut.toasts).toHaveLength(1)

		// Simulate the popover closing (browser fires toggle after exit transition)
		sut.onToggle(createToggleEvent('closed'), sut.toasts[0])

		expect(sut.toasts).toHaveLength(0)
	})

	it('should dismiss via handle', () => {
		const onDismiss = vi.fn()
		const toast = new Toast('Test', 'info', { onDismiss })
		publishToast(toast)
		insertMockElement(0)

		toast.handle!.dismiss()

		expect(onDismiss).toHaveBeenCalledOnce()
		expect(sut.toasts[0].dismissed).toBe(true)
	})

	it('should not double-dismiss', () => {
		const onDismiss = vi.fn()
		const toast = new Toast('Test', 'info', { onDismiss })
		publishToast(toast)
		insertMockElement(0)

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
		insertMockElement(0)

		vi.advanceTimersByTime(2500)
		expect(sut.toasts[0].dismissed).toBe(true)
	})

	it('should remove toast from array on toggle close (no container hidePopover needed)', () => {
		publishToast(new Toast('Test message'))
		insertMockElement(0)

		vi.advanceTimersByTime(2500)
		sut.onToggle(createToggleEvent('closed'), sut.toasts[0])

		expect(sut.toasts).toHaveLength(0)
	})

	it('should dismiss multiple toasts independently without interference', () => {
		publishToast(new Toast('A', 'info', { duration: 1000 }))
		publishToast(new Toast('B', 'info', { duration: 2000 }))
		publishToast(new Toast('C', 'info', { duration: 3000 }))
		insertMockElement(0)
		insertMockElement(1)
		insertMockElement(2)

		// Dismiss A
		vi.advanceTimersByTime(1000)
		expect(sut.toasts[0].dismissed).toBe(true)
		expect(sut.toasts[1].dismissed).toBe(false)
		expect(sut.toasts[2].dismissed).toBe(false)

		// Toggle removes A
		const toastA = sut.toasts[0]
		sut.onToggle(createToggleEvent('closed'), toastA)
		expect(sut.toasts).toHaveLength(2)

		// B and C still alive
		expect(sut.toasts[0].message).toBe('B')
		expect(sut.toasts[1].message).toBe('C')

		// Dismiss B
		vi.advanceTimersByTime(1000)
		expect(sut.toasts[0].dismissed).toBe(true)
		expect(sut.toasts[1].dismissed).toBe(false)
	})
})
