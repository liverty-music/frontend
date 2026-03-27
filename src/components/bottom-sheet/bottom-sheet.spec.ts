import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockHost = {
	showPopover: vi.fn(),
	hidePopover: vi.fn(),
	setAttribute: vi.fn(),
	addEventListener: vi.fn(),
	removeEventListener: vi.fn(),
	dispatchEvent: vi.fn(),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => mockHost),
		bindable: actual.bindable,
	}
})

import { BottomSheet } from './bottom-sheet'

describe('BottomSheet', () => {
	let sut: BottomSheet

	beforeEach(() => {
		vi.clearAllMocks()
		sut = new BottomSheet()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('open state', () => {
		it('calls showPopover when open changes to true', () => {
			sut.openChanged(true)

			expect(mockHost.showPopover).toHaveBeenCalledOnce()
		})

		it('calls hidePopover when open changes to false', () => {
			sut.openChanged(false)

			expect(mockHost.hidePopover).toHaveBeenCalledOnce()
		})

		it('suppresses hidePopover error when already hidden', () => {
			mockHost.hidePopover.mockImplementation(() => {
				throw new Error('not open')
			})

			expect(() => sut.openChanged(false)).not.toThrow()
		})

		it('suppresses showPopover error before attached (pre-attach)', () => {
			mockHost.showPopover.mockImplementation(() => {
				throw new DOMException('not a popover', 'InvalidStateError')
			})

			expect(() => sut.openChanged(true)).not.toThrow()
		})

		it('opens successfully when open is true at creation time and attached() runs', () => {
			// Simulate pre-attach: showPopover fails
			mockHost.showPopover.mockImplementationOnce(() => {
				throw new DOMException('not a popover', 'InvalidStateError')
			})

			// binding phase: open = true triggers openChanged
			sut.open = true
			sut.openChanged(true)
			expect(mockHost.showPopover).toHaveBeenCalledOnce()

			// attached phase: popover attribute is set, retry succeeds
			mockHost.showPopover.mockImplementation(() => {})
			sut.attached()
			expect(mockHost.showPopover).toHaveBeenCalledTimes(2)
		})
	})

	describe('attached lifecycle', () => {
		it('sets popover attribute to auto when dismissable', () => {
			sut.dismissable = true
			sut.attached()

			expect(mockHost.setAttribute).toHaveBeenCalledWith('popover', 'auto')
		})

		it('sets popover attribute to manual when not dismissable', () => {
			sut.dismissable = false
			sut.attached()

			expect(mockHost.setAttribute).toHaveBeenCalledWith('popover', 'manual')
		})

		it('sets role to dialog', () => {
			sut.attached()

			expect(mockHost.setAttribute).toHaveBeenCalledWith('role', 'dialog')
		})

		it('sets aria-label when provided', () => {
			sut.ariaLabel = 'Help sheet'
			sut.attached()

			expect(mockHost.setAttribute).toHaveBeenCalledWith(
				'aria-label',
				'Help sheet',
			)
		})

		it('registers toggle event listener', () => {
			sut.attached()

			expect(mockHost.addEventListener).toHaveBeenCalledWith(
				'toggle',
				expect.any(Function),
			)
		})
	})

	describe('detaching lifecycle', () => {
		it('removes toggle event listener', () => {
			sut.attached()
			sut.detaching()

			expect(mockHost.removeEventListener).toHaveBeenCalledWith(
				'toggle',
				expect.any(Function),
			)
		})
	})

	describe('scroll dismiss', () => {
		it('closes when scrolled to dismiss zone', () => {
			sut.open = true
			sut.dismissable = true

			const mockScrollArea = {
				scrollTop: 0,
				scrollHeight: 1000,
				clientHeight: 500,
			}
			Object.defineProperty(sut, 'scrollArea', {
				value: mockScrollArea,
				writable: true,
			})

			sut.onScrollEnd()

			expect(sut.open).toBe(false)
			expect(mockHost.dispatchEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sheet-closed' }),
			)
		})

		it('does not close when not dismissable', () => {
			sut.open = true
			sut.dismissable = false

			const mockScrollArea = {
				scrollTop: 0,
				scrollHeight: 1000,
				clientHeight: 500,
			}
			Object.defineProperty(sut, 'scrollArea', {
				value: mockScrollArea,
				writable: true,
			})

			sut.onScrollEnd()

			expect(sut.open).toBe(true)
		})
	})
})
