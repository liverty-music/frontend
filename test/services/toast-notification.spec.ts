import { DI, IEventAggregator } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from '../../src/components/toast-notification/toast'
import { ToastNotification } from '../../src/components/toast-notification/toast-notification'

describe('ToastNotification', () => {
	let sut: ToastNotification
	let ea: IEventAggregator
	let publishToast: (event: Toast) => void

	beforeEach(() => {
		vi.useFakeTimers()

		const container = DI.createContainer()
		container.register(ToastNotification)
		ea = container.get(IEventAggregator)
		sut = container.get(ToastNotification)

		// Mock popover container element for Top Layer API
		const mockContainer = document.createElement('div')
		;(mockContainer as any).showPopover = vi.fn()
		;(mockContainer as any).hidePopover = vi.fn()
		;(sut as any).containerElement = mockContainer

		// Subscribe by calling attaching lifecycle
		sut.attaching()

		publishToast = (event: Toast) => ea.publish(event)
	})

	afterEach(() => {
		sut.detaching()
		vi.restoreAllMocks()
	})

	it('should add toast to array', () => {
		publishToast(new Toast('Test message'))

		expect(sut.toasts).toHaveLength(1)
		expect(sut.toasts[0].message).toBe('Test message')
		expect(sut.toasts[0].visible).toBe(false)
	})

	it('should make toast visible after animation frame', () => {
		const rafSpy = vi
			.spyOn(global, 'requestAnimationFrame')
			.mockImplementation((cb) => {
				cb(0)
				return 0
			})

		publishToast(new Toast('Test message'))

		expect(rafSpy).toHaveBeenCalled()
		expect(sut.toasts[0].visible).toBe(true)
	})

	it('should auto-dismiss toast after duration', () => {
		vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
			cb(0)
			return 0
		})

		publishToast(new Toast('Test message', 'info', { duration: 2500 }))

		expect(sut.toasts[0].visible).toBe(true)

		vi.advanceTimersByTime(2500)
		expect(sut.toasts[0].visible).toBe(false)
	})

	it('should remove toast after exit animation delay', () => {
		publishToast(new Toast('Test message', 'info', { duration: 2500 }))

		vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
			cb(0)
			return 0
		})

		expect(sut.toasts).toHaveLength(1)

		vi.advanceTimersByTime(2500)
		expect(sut.toasts).toHaveLength(1)
		expect(sut.toasts[0].visible).toBe(false)

		vi.advanceTimersByTime(400)
		expect(sut.toasts).toHaveLength(0)
	})

	it('should dismiss even before requestAnimationFrame fires', () => {
		// Do NOT mock rAF — visible stays false
		const onDismiss = vi.fn()
		const toast = new Toast('Test', 'info', { onDismiss })
		publishToast(toast)

		expect(sut.toasts[0].visible).toBe(false)

		// Dismiss via handle before rAF fires
		toast.handle!.dismiss()

		expect(onDismiss).toHaveBeenCalledOnce()

		// Toast should be removed after exit animation
		vi.advanceTimersByTime(400)
		expect(sut.toasts).toHaveLength(0)
	})

	it('should not double-dismiss', () => {
		vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
			cb(0)
			return 0
		})

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
		vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
			cb(0)
			return 0
		})

		publishToast(new Toast('Test message'))

		// Default is 2500ms
		vi.advanceTimersByTime(2500)
		expect(sut.toasts[0].visible).toBe(false)
	})
})
