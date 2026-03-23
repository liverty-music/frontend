import { DI, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '../../src/components/bottom-sheet/bottom-sheet'

describe('BottomSheet', () => {
	let sut: BottomSheet
	let host: HTMLElement
	let scrollArea: HTMLDivElement

	beforeEach(() => {
		host = document.createElement('div')
		host.showPopover = vi.fn()
		host.hidePopover = vi.fn()
		host.addEventListener = vi.fn()
		host.removeEventListener = vi.fn()
		host.setAttribute = vi.fn()
		host.dispatchEvent = vi.fn().mockReturnValue(true)

		scrollArea = document.createElement('div')
		scrollArea.className = 'scroll-area'
		host.appendChild(scrollArea)

		const dismissZone = document.createElement('div')
		dismissZone.className = 'dismiss-zone'
		scrollArea.appendChild(dismissZone)

		const sheetBody = document.createElement('div')
		sheetBody.className = 'sheet-body'
		scrollArea.appendChild(sheetBody)

		const container = DI.createContainer()
		container.register(Registration.instance(INode, host))
		sut = container.get(BottomSheet)

		// Wire up the ref that Aurelia would set
		Object.defineProperty(sut, 'scrollArea', {
			value: scrollArea,
			writable: true,
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('openChanged()', () => {
		it('should call showPopover on host element', () => {
			sut.openChanged(true)

			expect(host.showPopover).toHaveBeenCalledOnce()
		})

		it('should call hidePopover on host element when closed', () => {
			sut.openChanged(false)

			expect(host.hidePopover).toHaveBeenCalledOnce()
		})
	})

	describe('attached()', () => {
		it('should set popover attribute on host for dismissable=true', () => {
			sut.dismissable = true
			sut.attached()

			expect(host.setAttribute).toHaveBeenCalledWith('popover', 'auto')
		})

		it('should set popover attribute on host for dismissable=false', () => {
			sut.dismissable = false
			sut.attached()

			expect(host.setAttribute).toHaveBeenCalledWith('popover', 'manual')
		})

		it('should register toggle listener on host', () => {
			sut.attached()

			expect(host.addEventListener).toHaveBeenCalledWith(
				'toggle',
				expect.any(Function),
			)
		})
	})

	describe('dismiss-zone DOM presence', () => {
		it('should have dismiss-zone in DOM when dismissable=true', () => {
			sut.dismissable = true
			const zone = scrollArea.querySelector('.dismiss-zone')
			expect(zone).not.toBeNull()
		})

		it('should have dismiss-zone in DOM when dismissable=false', () => {
			sut.dismissable = false
			const zone = scrollArea.querySelector('.dismiss-zone')
			expect(zone).not.toBeNull()
		})
	})

	describe('onScrollEnd()', () => {
		it('should not dismiss when dismissable=false', () => {
			sut.dismissable = false
			Object.defineProperty(scrollArea, 'scrollTop', { value: 0 })
			Object.defineProperty(scrollArea, 'scrollHeight', { value: 1000 })
			Object.defineProperty(scrollArea, 'clientHeight', { value: 500 })

			sut.onScrollEnd()

			expect(host.dispatchEvent).not.toHaveBeenCalled()
		})

		it('should dismiss when dismissable=true and scrolled to top', () => {
			sut.dismissable = true
			sut.open = true
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

			expect(sut.open).toBe(false)
			expect(host.dispatchEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'sheet-closed' }),
			)
		})
	})

	describe('detaching()', () => {
		it('should remove toggle listener and hide popover', () => {
			sut.detaching()

			expect(host.removeEventListener).toHaveBeenCalledWith(
				'toggle',
				expect.any(Function),
			)
			expect(host.hidePopover).toHaveBeenCalledOnce()
		})
	})
})
