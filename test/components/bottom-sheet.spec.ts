import { DI, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '../../src/components/bottom-sheet/bottom-sheet'

function makeDialog() {
	return {
		open: false,
		showModal: vi.fn(function (this: { open: boolean }) {
			this.open = true
		}),
		close: vi.fn(function (this: { open: boolean }) {
			this.open = false
		}),
		setAttribute: vi.fn(),
	}
}

describe('BottomSheet', () => {
	let sut: BottomSheet
	let host: HTMLElement
	let dialog: ReturnType<typeof makeDialog>
	let scrollArea: HTMLDivElement
	let dismissZone: HTMLDivElement

	beforeEach(() => {
		host = document.createElement('div')
		host.dispatchEvent = vi.fn().mockReturnValue(true)

		dialog = makeDialog()
		scrollArea = document.createElement('div')
		scrollArea.className = 'scroll-area'
		dismissZone = document.createElement('div')
		dismissZone.className = 'dismiss-zone'

		const container = DI.createContainer()
		container.register(Registration.instance(INode, host))
		sut = container.get(BottomSheet)

		Object.defineProperty(sut, 'dialogEl', { value: dialog, writable: true })
		Object.defineProperty(sut, 'scrollArea', {
			value: scrollArea,
			writable: true,
		})
		Object.defineProperty(sut, 'dismissZone', {
			value: dismissZone,
			writable: true,
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('openChanged()', () => {
		it('calls showModal on the inner dialog when opening', () => {
			sut.openChanged(true)

			expect(dialog.showModal).toHaveBeenCalledOnce()
		})

		it('calls close on the inner dialog when closing', () => {
			dialog.open = true
			sut.openChanged(false)

			expect(dialog.close).toHaveBeenCalledOnce()
		})
	})

	describe('close request (cancel)', () => {
		it('prevents default for a non-dismissable sheet', () => {
			const e = { preventDefault: vi.fn() } as unknown as Event
			sut.dismissable = false

			sut.onCancel(e)

			expect(e.preventDefault).toHaveBeenCalledOnce()
		})

		it('allows the request for a dismissable sheet', () => {
			const e = { preventDefault: vi.fn() } as unknown as Event
			sut.dismissable = true

			sut.onCancel(e)

			expect(e.preventDefault).not.toHaveBeenCalled()
		})
	})

	describe('onScrollEnd()', () => {
		it('does not dismiss when dismissable=false', () => {
			sut.dismissable = false
			Object.defineProperty(scrollArea, 'scrollTop', { value: 0 })
			Object.defineProperty(scrollArea, 'scrollHeight', { value: 1000 })
			Object.defineProperty(scrollArea, 'clientHeight', { value: 500 })

			sut.onScrollEnd()

			expect(dialog.close).not.toHaveBeenCalled()
		})

		it('dismisses when dismissable=true and scrolled to the dismiss zone', () => {
			sut.dismissable = true
			sut.open = true
			dialog.open = true
			Object.defineProperty(scrollArea, 'scrollTop', {
				value: 0,
				configurable: true,
			})
			Object.defineProperty(scrollArea, 'scrollHeight', {
				value: 1000,
				configurable: true,
			})
			Object.defineProperty(scrollArea, 'clientHeight', {
				value: 500,
				configurable: true,
			})

			sut.onScrollEnd()
			sut.onClose()

			expect(sut.open).toBe(false)
			expect(host.dispatchEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sheet-closed' }),
			)
		})
	})

	describe('tap-outside dismiss', () => {
		it('closes a dismissable sheet on dismiss-zone click', () => {
			dialog.open = true
			sut.dismissable = true

			sut.onDismissZoneClick()

			expect(dialog.close).toHaveBeenCalledOnce()
		})

		it('does not close a non-dismissable sheet on dismiss-zone click', () => {
			dialog.open = true
			sut.dismissable = false

			sut.onDismissZoneClick()

			expect(dialog.close).not.toHaveBeenCalled()
		})
	})

	describe('detaching()', () => {
		it('closes the dialog without emitting sheet-closed', () => {
			dialog.open = true

			sut.detaching()

			expect(dialog.close).toHaveBeenCalledOnce()
			expect(host.dispatchEvent).not.toHaveBeenCalled()
		})
	})
})
