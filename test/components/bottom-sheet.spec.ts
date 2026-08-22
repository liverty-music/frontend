import { DI, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '../../src/components/bottom-sheet/bottom-sheet'

function makePopover() {
	return {
		showPopover: vi.fn(),
		hidePopover: vi.fn(),
		setAttribute: vi.fn(),
		querySelectorAll: vi.fn(() => [] as unknown as NodeListOf<HTMLElement>),
	}
}

describe('BottomSheet', () => {
	let sut: BottomSheet
	let host: HTMLElement
	let popover: ReturnType<typeof makePopover>
	let scrollArea: HTMLDivElement
	let sheetBody: HTMLElement

	beforeEach(() => {
		host = document.createElement('div')
		host.dispatchEvent = vi.fn().mockReturnValue(true)

		popover = makePopover()
		scrollArea = document.createElement('div')
		scrollArea.className = 'scroll-area'
		scrollArea.scrollTo = vi.fn()
		sheetBody = document.createElement('section')
		sheetBody.className = 'sheet-body'

		const container = DI.createContainer()
		container.register(Registration.instance(INode, host))
		sut = container.get(BottomSheet)

		Object.defineProperty(sut, 'popoverEl', { value: popover, writable: true })
		Object.defineProperty(sut, 'scrollArea', {
			value: scrollArea,
			writable: true,
		})
		Object.defineProperty(sut, 'sheetBody', {
			value: sheetBody,
			writable: true,
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	// Drive the sheet to open+settled without a real IntersectionObserver.
	function openAndSettle(): void {
		sut.openChanged(true)
		sut.updateVisibility(1)
	}

	describe('openChanged()', () => {
		it('calls showPopover on the host when opening', () => {
			sut.openChanged(true)

			expect(popover.showPopover).toHaveBeenCalledOnce()
		})

		it('scrolls to the dismiss zone (closed stop) when closing', () => {
			openAndSettle()

			sut.openChanged(false)

			expect(scrollArea.scrollTo).toHaveBeenCalledWith(
				expect.objectContaining({ top: 0 }),
			)
		})
	})

	describe('dismiss via IntersectionObserver', () => {
		it('hides and emits sheet-closed when the body leaves the viewport after settling', () => {
			openAndSettle()
			sut.open = true

			sut.updateVisibility(0)

			expect(popover.hidePopover).toHaveBeenCalledOnce()
			expect(sut.open).toBe(false)
			expect(host.dispatchEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sheet-closed' }),
			)
		})

		it('does not dismiss before the sheet has settled (just-opened guard)', () => {
			sut.openChanged(true)
			// Transient off-screen ratio during the open re-snap, before settle.
			sut.updateVisibility(0)

			expect(popover.hidePopover).not.toHaveBeenCalled()
		})

		it('stays open when the gesture reverses back to the body (no bounce-back)', () => {
			openAndSettle()

			sut.updateVisibility(0.5)
			sut.updateVisibility(1)

			expect(popover.hidePopover).not.toHaveBeenCalled()
			expect(host.dispatchEvent).not.toHaveBeenCalled()
		})
	})

	describe('tap-outside dismiss', () => {
		it('closes a dismissable sheet on dismiss-zone click', () => {
			openAndSettle()
			sut.dismissable = true

			sut.onDismissZoneClick()

			expect(scrollArea.scrollTo).toHaveBeenCalled()
		})

		it('does not close a non-dismissable sheet on dismiss-zone click', () => {
			openAndSettle()
			sut.dismissable = false
			;(scrollArea.scrollTo as ReturnType<typeof vi.fn>).mockClear()

			sut.onDismissZoneClick()

			expect(scrollArea.scrollTo).not.toHaveBeenCalled()
		})
	})

	describe('detaching()', () => {
		it('hides the popover without emitting sheet-closed', () => {
			openAndSettle()

			sut.detaching()

			expect(popover.hidePopover).toHaveBeenCalledOnce()
			expect(host.dispatchEvent).not.toHaveBeenCalled()
		})
	})
})
