import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockHost = {
	getAttribute: vi.fn(() => null),
	dispatchEvent: vi.fn(() => true),
}

const mockTracker = { opened: vi.fn(), closed: vi.fn() }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		// The host for INode; an open-sheet tracker stand-in for anything else.
		resolve: vi.fn((key: unknown) =>
			key === actual.INode ? mockHost : mockTracker,
		),
		bindable: actual.bindable,
	}
})

import { BottomSheet } from './bottom-sheet'

function makePopover() {
	return {
		showPopover: vi.fn(),
		hidePopover: vi.fn(),
		setAttribute: vi.fn(),
		removeAttribute: vi.fn(),
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

	// @spec components/infrastructure/fan/web/global/bottom-sheet "Open bound to true at component creation time"
	it('survives a failed showPopover before attach and opens at attached()', () => {
		popover.showPopover.mockImplementationOnce(() => {
			throw new DOMException('not connected', 'InvalidStateError')
		})

		// `open` is bound true during binding, before the popover ref resolves.
		sut.open = true
		expect(() => sut.openChanged(true)).not.toThrow()
		expect(popover.showPopover).toHaveBeenCalledOnce()
		expect(mockTracker.opened).not.toHaveBeenCalled()

		// attached() retries once the ref is initialized, and the sheet opens.
		sut.attached()
		expect(popover.showPopover).toHaveBeenCalledTimes(2)
		expect(mockTracker.opened).toHaveBeenCalledOnce()
		// An opening is not a close: nothing was hidden or reported.
		expect(popover.hidePopover).not.toHaveBeenCalled()
		expect(mockHost.dispatchEvent).not.toHaveBeenCalled()
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

	// @spec components/infrastructure/fan/web/global/bottom-sheet "Sheet with a heading"
	describe('heading', () => {
		it('names the popover by its heading instead of an aria-label', () => {
			sut.ariaLabel = 'Select language'
			sut.heading = 'Language'
			sut.attached()

			expect(popover.setAttribute).toHaveBeenCalledWith(
				'aria-labelledby',
				sut.headingId,
			)
			expect(popover.removeAttribute).toHaveBeenCalledWith('aria-label')
			expect(popover.setAttribute).not.toHaveBeenCalledWith(
				'aria-label',
				expect.anything(),
			)
		})

		it('goes back to the aria-label when the heading is cleared', () => {
			sut.ariaLabel = 'Select language'
			sut.heading = 'Language'
			sut.attached()
			sut.heading = ''
			sut.headingChanged()

			expect(popover.removeAttribute).toHaveBeenCalledWith('aria-labelledby')
			expect(popover.setAttribute).toHaveBeenCalledWith(
				'aria-label',
				'Select language',
			)
		})

		it('gives every sheet its own heading id', () => {
			expect(new BottomSheet().headingId).not.toBe(sut.headingId)
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

		it('does not emit sheet-closed for a programmatic close, only sheet-hidden', () => {
			openAndSettle()
			sut.open = true

			sut.openChanged(false)
			// Settle detection completes the close.
			sut.updateVisibility(0)

			expect(popover.hidePopover).toHaveBeenCalledOnce()
			expect(mockHost.dispatchEvent).toHaveBeenCalledOnce()
			expect(mockHost.dispatchEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sheet-hidden' }),
			)
		})
	})

	describe('tap-outside dismiss', () => {
		it('closes a dismissable sheet on dismiss-zone click and emits sheet-closed', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Dismiss sheet by tapping outside it or pressing Escape"
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
			// @spec components/infrastructure/fan/web/route/dashboard "Dismiss sheet via swipe down"
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

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Just-opened dismiss guard"
		it('suppresses every dismiss signal until the body has settled, then releases', () => {
			sut.openChanged(true)
			touchScrollArea() // even a user gesture cannot dismiss a sheet still opening

			// Open transition: the body is off-screen or half-way, then on-screen
			// but not yet fully visible. None of it closes the sheet.
			sut.updateVisibility(0)
			sut.updateVisibility(0.5)
			sut.updateVisibility(0.05)
			expect(popover.hidePopover).not.toHaveBeenCalled()
			expect(mockHost.dispatchEvent).not.toHaveBeenCalled()

			// The body settles fully visible: the guard releases, and the first
			// swipe after that closes the sheet.
			sut.updateVisibility(1)
			sut.updateVisibility(0)
			expect(popover.hidePopover).toHaveBeenCalledOnce()
			expect(mockHost.dispatchEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sheet-closed' }),
			)
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
			// @spec components/infrastructure/fan/web/route/dashboard "Dismiss sheet by tapping outside it or pressing Escape"
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

	describe('Tab focus trap', () => {
		const fireKeydown = (s: BottomSheet, e: KeyboardEvent): void => {
			;(s as unknown as { onKeydown: (e: KeyboardEvent) => void }).onKeydown(e)
		}
		const control = (visible: boolean) => ({
			focus: vi.fn(),
			checkVisibility: () => visible,
		})
		const tab = (shiftKey: boolean) =>
			({
				key: 'Tab',
				shiftKey,
				preventDefault: vi.fn(),
			}) as unknown as KeyboardEvent

		// A sheet holding a form (first field, Save) and, after it, the buttons
		// of a closed confirmation dialog, which are not rendered.
		function withControls() {
			const first = control(true)
			const save = control(true)
			const hiddenCancel = control(false)
			const hiddenConfirm = control(false)
			popover.querySelectorAll.mockReturnValue([
				first,
				save,
				hiddenCancel,
				hiddenConfirm,
			] as unknown as NodeListOf<HTMLElement>)
			return { first, save, hiddenConfirm }
		}

		it('wraps Shift+Tab from the first control to the last rendered one', () => {
			openAndSettle()
			const { first, save, hiddenConfirm } = withControls()
			vi.spyOn(document, 'activeElement', 'get').mockReturnValue(
				first as unknown as Element,
			)
			const e = tab(true)
			fireKeydown(sut, e)
			expect(e.preventDefault).toHaveBeenCalled()
			expect(save.focus).toHaveBeenCalled()
			expect(hiddenConfirm.focus).not.toHaveBeenCalled()
		})

		it('wraps Tab from the last rendered control to the first', () => {
			openAndSettle()
			const { first, save } = withControls()
			vi.spyOn(document, 'activeElement', 'get').mockReturnValue(
				save as unknown as Element,
			)
			const e = tab(false)
			fireKeydown(sut, e)
			expect(e.preventDefault).toHaveBeenCalled()
			expect(first.focus).toHaveBeenCalled()
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
