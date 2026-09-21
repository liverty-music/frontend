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

function makePopover() {
	return {
		showPopover: vi.fn(),
		hidePopover: vi.fn(),
		setAttribute: vi.fn(),
		querySelectorAll: vi.fn(() => [] as unknown as NodeListOf<HTMLElement>),
	}
}

function makeScrollArea() {
	return {
		scrollTop: 500,
		scrollTo: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	}
}

describe('BottomSheet', () => {
	let sut: BottomSheet
	let popover: ReturnType<typeof makePopover>
	let scrollArea: ReturnType<typeof makeScrollArea>

	beforeEach(() => {
		vi.clearAllMocks()
		mockHost.getAttribute.mockReturnValue(null)
		sut = new BottomSheet()
		popover = makePopover()
		scrollArea = makeScrollArea()
		Object.defineProperty(sut, 'popoverEl', { value: popover, writable: true })
		Object.defineProperty(sut, 'scrollArea', {
			value: scrollArea,
			writable: true,
		})
		Object.defineProperty(sut, 'sheetBody', {
			value: { focus: vi.fn() },
			writable: true,
		})
		Object.defineProperty(sut, 'dismissZone', {
			value: { focus: vi.fn() },
			writable: true,
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	// Drives the sheet to the open+settled state without a real
	// IntersectionObserver, including the user interaction a swipe implies.
	function openAndSettle(): void {
		sut.openChanged(true)
		sut.updateVisibility(1) // body fully visible → settled
		touchScrollArea()
	}

	/** Fire the first user gesture on the scroll area, as a real swipe would. */
	function touchScrollArea(): void {
		const call = scrollArea.addEventListener.mock.calls.find(
			([type]: [string]) => type === 'pointerdown',
		)
		expect(call, 'pointerdown listener should be armed while open').toBeTruthy()
		call?.[1]()
	}

	describe('open state', () => {
		it('calls showPopover when open changes to true', () => {
			sut.openChanged(true)

			expect(popover.showPopover).toHaveBeenCalledOnce()
		})

		it('does not call showPopover twice if already showing', () => {
			sut.openChanged(true)
			sut.openChanged(true)

			expect(popover.showPopover).toHaveBeenCalledOnce()
		})

		it('suppresses showPopover error before attached (pre-attach)', () => {
			popover.showPopover.mockImplementation(() => {
				throw new DOMException('not connected', 'InvalidStateError')
			})

			expect(() => sut.openChanged(true)).not.toThrow()
		})

		it('retries showPopover in attached() when open is true at creation', () => {
			popover.showPopover.mockImplementationOnce(() => {
				throw new DOMException('not connected', 'InvalidStateError')
			})

			sut.open = true
			sut.openChanged(true)
			expect(popover.showPopover).toHaveBeenCalledOnce()

			sut.attached()
			expect(popover.showPopover).toHaveBeenCalledTimes(2)
		})
	})

	describe('aria-label', () => {
		it('mirrors the ariaLabel bindable onto the popover in attached()', () => {
			sut.ariaLabel = 'Select language'
			sut.attached()

			expect(popover.setAttribute).toHaveBeenCalledWith(
				'aria-label',
				'Select language',
			)
		})

		it('falls back to the host aria-label when the bindable is empty', () => {
			mockHost.getAttribute.mockReturnValue('Help sheet')
			sut.ariaLabel = ''
			sut.attached()

			expect(popover.setAttribute).toHaveBeenCalledWith(
				'aria-label',
				'Help sheet',
			)
		})
	})

	describe('programmatic close', () => {
		it('scrolls to the dismiss zone when open is set to false', () => {
			openAndSettle()

			sut.openChanged(false)

			expect(scrollArea.scrollTo).toHaveBeenCalledWith(
				expect.objectContaining({ top: 0 }),
			)
		})

		it('does not emit sheet-closed for a programmatic close', () => {
			openAndSettle()
			sut.open = true

			sut.openChanged(false)
			// Settle detection completes the close.
			sut.updateVisibility(0)

			expect(popover.hidePopover).toHaveBeenCalledOnce()
			expect(mockHost.dispatchEvent).not.toHaveBeenCalled()
		})
	})

	describe('tap-outside dismiss', () => {
		it('closes a dismissable sheet on dismiss-zone click and emits sheet-closed', () => {
			openAndSettle()
			sut.dismissable = true

			sut.onDismissZoneClick()
			expect(scrollArea.scrollTo).toHaveBeenCalled()

			sut.updateVisibility(0)
			expect(popover.hidePopover).toHaveBeenCalledOnce()
			expect(mockHost.dispatchEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sheet-closed' }),
			)
		})

		it('does not close when not dismissable', () => {
			openAndSettle()
			sut.dismissable = false

			sut.onDismissZoneClick()

			expect(scrollArea.scrollTo).not.toHaveBeenCalled()
		})
	})

	describe('swipe dismiss (IntersectionObserver)', () => {
		it('closes and emits sheet-closed when the body leaves the viewport after settling', () => {
			openAndSettle()

			// User swipes the body off-screen.
			sut.updateVisibility(0)

			expect(popover.hidePopover).toHaveBeenCalledOnce()
			expect(mockHost.dispatchEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sheet-closed' }),
			)
		})

		it('does not close before the sheet has settled (just-opened guard)', () => {
			sut.openChanged(true)
			// Never settled: a transient off-screen ratio during the open re-snap.
			sut.updateVisibility(0)

			expect(popover.hidePopover).not.toHaveBeenCalled()
		})

		it('does not close on an engine re-snap the user never triggered', () => {
			// Regression guard for the WebKit "flash then close" defect (#540).
			// The `initial-snap` keyframe suppresses the dismiss-zone snap point
			// for 0.01s so the browser lands on the body; when it ends, the snap
			// point returns and WebKit re-snaps AWAY from the body. By then the
			// sheet has settled, so `settled` alone let that engine-driven scroll
			// close the sheet ~400ms after opening, untouched.
			sut.openChanged(true)
			sut.updateVisibility(1) // settled — body was fully visible
			// NO user gesture here: this scroll is the engine's, not a swipe.
			sut.updateVisibility(0)

			expect(popover.hidePopover).not.toHaveBeenCalled()
			expect(mockHost.dispatchEvent).not.toHaveBeenCalled()
		})

		it('closes once the user has touched the sheet, after an engine re-snap', () => {
			// The guard must not make the sheet un-dismissable: the same ratio
			// that was ignored above closes it once a real gesture has happened.
			sut.openChanged(true)
			sut.updateVisibility(1)
			sut.updateVisibility(0) // engine re-snap — ignored
			expect(popover.hidePopover).not.toHaveBeenCalled()

			touchScrollArea()
			sut.updateVisibility(1) // user drags back to the body
			sut.updateVisibility(0) // then swipes it away

			expect(popover.hidePopover).toHaveBeenCalledOnce()
		})

		it('stays open when the gesture reverses back to the body (no bounce-back)', () => {
			openAndSettle()

			sut.updateVisibility(0.5) // partial swipe — mid-scroll, no decision
			sut.updateVisibility(1) // reversed back to fully visible

			expect(popover.hidePopover).not.toHaveBeenCalled()
			expect(mockHost.dispatchEvent).not.toHaveBeenCalled()
		})
	})

	describe('escape key', () => {
		// Access the private document-level keydown handler under test.
		const fireKeydown = (s: BottomSheet, e: KeyboardEvent): void => {
			;(s as unknown as { onKeydown: (e: KeyboardEvent) => void }).onKeydown(e)
		}

		it('dismisses a dismissable sheet on Escape', () => {
			openAndSettle()
			sut.dismissable = true
			const e = {
				key: 'Escape',
				preventDefault: vi.fn(),
			} as unknown as KeyboardEvent

			fireKeydown(sut, e)

			expect(scrollArea.scrollTo).toHaveBeenCalled()
		})

		it('does not dismiss on Escape when not dismissable', () => {
			openAndSettle()
			sut.dismissable = false
			const e = {
				key: 'Escape',
				preventDefault: vi.fn(),
			} as unknown as KeyboardEvent

			fireKeydown(sut, e)

			expect(scrollArea.scrollTo).not.toHaveBeenCalled()
		})
	})

	describe('detaching lifecycle', () => {
		it('hides the popover without emitting sheet-closed', () => {
			openAndSettle()

			sut.detaching()

			expect(popover.hidePopover).toHaveBeenCalledOnce()
			expect(mockHost.dispatchEvent).not.toHaveBeenCalled()
		})
	})
})
