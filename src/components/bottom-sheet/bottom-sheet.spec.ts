import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockHost = {
	getAttribute: vi.fn(() => null),
	dispatchEvent: vi.fn(() => true),
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

function makeDialog() {
	const dialog = {
		open: false,
		showModal: vi.fn(function (this: { open: boolean }) {
			this.open = true
		}),
		close: vi.fn(function (this: { open: boolean }) {
			this.open = false
		}),
		setAttribute: vi.fn(),
	}
	return dialog
}

describe('BottomSheet', () => {
	let sut: BottomSheet
	let dialog: ReturnType<typeof makeDialog>

	beforeEach(() => {
		vi.clearAllMocks()
		mockHost.getAttribute.mockReturnValue(null)
		sut = new BottomSheet()
		dialog = makeDialog()
		Object.defineProperty(sut, 'dialogEl', { value: dialog, writable: true })
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('open state', () => {
		it('calls showModal when open changes to true', () => {
			sut.openChanged(true)

			expect(dialog.showModal).toHaveBeenCalledOnce()
			expect(dialog.open).toBe(true)
		})

		it('calls close when open changes to false', () => {
			dialog.open = true
			sut.openChanged(false)

			expect(dialog.close).toHaveBeenCalledOnce()
		})

		it('does not call showModal twice if already open', () => {
			dialog.open = true
			sut.openChanged(true)

			expect(dialog.showModal).not.toHaveBeenCalled()
		})

		it('suppresses showModal error before attached (pre-attach)', () => {
			dialog.showModal.mockImplementation(() => {
				throw new DOMException('not connected', 'InvalidStateError')
			})

			expect(() => sut.openChanged(true)).not.toThrow()
		})

		it('retries showModal in attached() when open is true at creation', () => {
			dialog.showModal.mockImplementationOnce(() => {
				throw new DOMException('not connected', 'InvalidStateError')
			})

			sut.open = true
			sut.openChanged(true)
			expect(dialog.showModal).toHaveBeenCalledOnce()

			sut.attached()
			expect(dialog.showModal).toHaveBeenCalledTimes(2)
			expect(dialog.open).toBe(true)
		})
	})

	describe('aria-label', () => {
		it('mirrors the ariaLabel bindable onto the dialog in attached()', () => {
			sut.ariaLabel = 'Select language'
			sut.attached()

			expect(dialog.setAttribute).toHaveBeenCalledWith(
				'aria-label',
				'Select language',
			)
		})

		it('falls back to the host aria-label when the bindable is empty', () => {
			mockHost.getAttribute.mockReturnValue('Help sheet')
			sut.ariaLabel = ''
			sut.attached()

			expect(dialog.setAttribute).toHaveBeenCalledWith(
				'aria-label',
				'Help sheet',
			)
		})
	})

	describe('close request (ESC / Android back)', () => {
		it('prevents default when not dismissable', () => {
			const e = { preventDefault: vi.fn() } as unknown as Event
			sut.dismissable = false

			sut.onCancel(e)

			expect(e.preventDefault).toHaveBeenCalledOnce()
		})

		it('allows the request and emits sheet-closed when dismissable', () => {
			const e = { preventDefault: vi.fn() } as unknown as Event
			sut.dismissable = true
			sut.open = true

			sut.onCancel(e)
			expect(e.preventDefault).not.toHaveBeenCalled()

			// Native `close` event follows the cancel.
			sut.onClose()
			expect(sut.open).toBe(false)
			expect(mockHost.dispatchEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sheet-closed' }),
			)
		})
	})

	describe('onClose', () => {
		it('does not emit sheet-closed for a programmatic close', () => {
			sut.open = true

			// No prior user-dismiss signal → programmatic.
			sut.onClose()

			expect(sut.open).toBe(false)
			expect(mockHost.dispatchEvent).not.toHaveBeenCalled()
		})
	})

	describe('tap-outside dismiss', () => {
		it('closes a dismissable sheet on dismiss-zone click', () => {
			dialog.open = true
			sut.dismissable = true

			sut.onDismissZoneClick()
			expect(dialog.close).toHaveBeenCalledOnce()

			sut.onClose()
			expect(mockHost.dispatchEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sheet-closed' }),
			)
		})

		it('does not close when not dismissable', () => {
			dialog.open = true
			sut.dismissable = false

			sut.onDismissZoneClick()

			expect(dialog.close).not.toHaveBeenCalled()
		})
	})

	describe('swipe dismiss', () => {
		const scrolledToTop = {
			scrollTop: 0,
			scrollHeight: 1000,
			clientHeight: 500,
		}

		it('closes when scrolled to the dismiss zone and dismissable', () => {
			sut.open = true
			sut.dismissable = true
			dialog.open = true
			Object.defineProperty(sut, 'scrollArea', {
				value: scrolledToTop,
				writable: true,
			})

			sut.onScrollEnd()

			expect(dialog.close).toHaveBeenCalledOnce()
		})

		it('does not close when not dismissable', () => {
			sut.dismissable = false
			Object.defineProperty(sut, 'scrollArea', {
				value: scrolledToTop,
				writable: true,
			})

			sut.onScrollEnd()

			expect(dialog.close).not.toHaveBeenCalled()
		})

		it('closes on snap-change to the dismiss zone', () => {
			const dismissZone = {} as HTMLElement
			Object.defineProperty(sut, 'dismissZone', {
				value: dismissZone,
				writable: true,
			})
			dialog.open = true
			sut.dismissable = true

			sut.onSnapChange({ snapTargetBlock: dismissZone } as unknown as Event)

			expect(dialog.close).toHaveBeenCalledOnce()
		})
	})

	describe('detaching lifecycle', () => {
		it('closes the dialog without emitting sheet-closed', () => {
			dialog.open = true

			sut.detaching()

			expect(dialog.close).toHaveBeenCalledOnce()
			expect(mockHost.dispatchEvent).not.toHaveBeenCalled()
		})
	})
})
