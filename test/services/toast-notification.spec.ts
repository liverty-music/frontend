import { DI } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	IToastService,
	ToastNotification,
} from '../../src/components/toast-notification/toast-notification'

describe('ToastNotification', () => {
	let sut: ToastNotification

	beforeEach(() => {
		vi.useFakeTimers()
		const container = DI.createContainer()
		container.register(ToastNotification)
		sut = container.get(IToastService)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should add toast to array', () => {
		// Act
		sut.show('Test message')

		// Assert
		expect(sut.toasts).toHaveLength(1)
		expect(sut.toasts[0].message).toBe('Test message')
		expect(sut.toasts[0].visible).toBe(false)
	})

	it('should make toast visible after animation frame', async () => {
		// Arrange
		const rafSpy = vi
			.spyOn(global, 'requestAnimationFrame')
			.mockImplementation((cb) => {
				cb(0)
				return 0
			})

		// Act
		sut.show('Test message')

		// Assert
		expect(rafSpy).toHaveBeenCalled()
		expect(sut.toasts[0].visible).toBe(true)
	})

	it('should auto-dismiss toast after duration', () => {
		// Arrange
		const rafSpy = vi
			.spyOn(global, 'requestAnimationFrame')
			.mockImplementation((cb) => {
				cb(0)
				return 0
			})

		// Act
		sut.show('Test message', 2500)

		// Assert - RAF was called and made toast visible
		expect(rafSpy).toHaveBeenCalled()
		expect(sut.toasts[0].visible).toBe(true)

		// Advance time to trigger dismiss
		vi.advanceTimersByTime(2500)
		expect(sut.toasts[0].visible).toBe(false)
	})

	it('should remove toast after exit animation delay', () => {
		// Act
		sut.show('Test message', 2500)

		// Make visible
		vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
			cb(0)
			return 0
		})

		// Assert - toast exists
		expect(sut.toasts).toHaveLength(1)

		// Advance to dismiss
		vi.advanceTimersByTime(2500)
		expect(sut.toasts).toHaveLength(1)
		expect(sut.toasts[0].visible).toBe(false)

		// Advance for removal delay (400ms)
		vi.advanceTimersByTime(400)
		expect(sut.toasts).toHaveLength(0)
	})

	it('should handle multiple toasts with unique IDs', () => {
		// Act
		sut.show('Message 1')
		sut.show('Message 2')
		sut.show('Message 3')

		// Assert
		expect(sut.toasts).toHaveLength(3)
		expect(sut.toasts[0].id).toBe(0)
		expect(sut.toasts[1].id).toBe(1)
		expect(sut.toasts[2].id).toBe(2)
	})

	it('should use default duration if not specified', () => {
		// Act
		sut.show('Test message')

		// Make visible
		vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
			cb(0)
			return 0
		})

		// Assert - default is 2500ms
		vi.advanceTimersByTime(2500)
		expect(sut.toasts[0].visible).toBe(false)
	})
})
