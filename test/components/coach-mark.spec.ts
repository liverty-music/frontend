import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '../helpers/mock-logger'

const { CoachMark } = await import('../../src/components/coach-mark/coach-mark')

function createMockElement(
	opts: { top?: number; height?: number } = {},
): HTMLElement {
	const el = document.createElement('div')
	el.getBoundingClientRect = () =>
		({
			top: opts.top ?? 100,
			bottom: (opts.top ?? 100) + (opts.height ?? 50),
			left: 50,
			right: 200,
			width: 150,
			height: opts.height ?? 50,
			x: 50,
			y: opts.top ?? 100,
			toJSON: () => ({}),
		}) as DOMRect
	return el
}

describe('CoachMark', () => {
	let sut: InstanceType<typeof CoachMark>
	let targetEl: HTMLElement

	beforeEach(() => {
		vi.useFakeTimers()

		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		sut = container.invoke(CoachMark)

		targetEl = createMockElement()
		targetEl.setAttribute('data-test-target', '')
		document.body.appendChild(targetEl)

		sut.targetSelector = '[data-test-target]'
	})

	afterEach(() => {
		vi.useRealTimers()
		if (targetEl.parentNode) document.body.removeChild(targetEl)
		vi.restoreAllMocks()
	})

	describe('highlight', () => {
		it('sets anchor-name on target and becomes visible when activated', () => {
			sut.active = true
			sut.activeChanged()

			expect(targetEl.style.getPropertyValue('anchor-name')).toBe(
				'--coach-target',
			)
			expect(sut.visible).toBe(true)
		})
	})

	describe('deactivate', () => {
		it('clears anchor-name and visibility', () => {
			sut.active = true
			sut.activeChanged()

			sut.deactivate()

			expect(targetEl.style.getPropertyValue('anchor-name')).toBe('')
			expect(sut.visible).toBe(false)
		})

		it('does not lock viewport scroll (non-blocking)', () => {
			const viewport = document.createElement('au-viewport')
			document.body.appendChild(viewport)

			sut.active = true
			sut.activeChanged()

			// The coach mark never forces overflow:hidden on the viewport.
			expect(viewport.style.getPropertyValue('overflow')).toBe('')

			sut.deactivate()
			expect(viewport.style.getPropertyValue('overflow')).toBe('')

			document.body.removeChild(viewport)
		})
	})

	describe('target click', () => {
		it('delegates to the target native click and invokes onTap', () => {
			const onTap = vi.fn()
			sut.onTap = onTap
			sut.active = true
			sut.activeChanged()

			const clickSpy = vi.spyOn(targetEl, 'click')
			const event = new Event('click', { bubbles: true })
			vi.spyOn(event, 'preventDefault')
			vi.spyOn(event, 'stopPropagation')

			sut.onTargetClick(event)

			expect(clickSpy).toHaveBeenCalledTimes(1)
			expect(onTap).toHaveBeenCalledTimes(1)
			expect(event.preventDefault).toHaveBeenCalled()
			expect(event.stopPropagation).toHaveBeenCalled()
		})

		it('does not throw when onTap is undefined', () => {
			sut.onTap = undefined
			const event = new Event('click')
			expect(() => sut.onTargetClick(event)).not.toThrow()
		})
	})

	describe('keyboard handler', () => {
		it('invokes onTap on Enter', () => {
			const onTap = vi.fn()
			sut.onTap = onTap
			const event = new KeyboardEvent('keydown', { key: 'Enter' })
			vi.spyOn(event, 'preventDefault')

			sut.onKeydown(event)

			expect(onTap).toHaveBeenCalledTimes(1)
			expect(event.preventDefault).toHaveBeenCalled()
		})

		it('invokes onTap on Space', () => {
			const onTap = vi.fn()
			sut.onTap = onTap
			sut.onKeydown(new KeyboardEvent('keydown', { key: ' ' }))
			expect(onTap).toHaveBeenCalledTimes(1)
		})

		it('ignores other keys', () => {
			const onTap = vi.fn()
			sut.onTap = onTap
			sut.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }))
			expect(onTap).not.toHaveBeenCalled()
		})
	})

	describe('retry behavior', () => {
		it('sets visible to false when target is not found after retries', async () => {
			sut.targetSelector = '[data-nonexistent]'
			sut.active = true
			sut.activeChanged()

			await vi.advanceTimersByTimeAsync(6000)

			expect(sut.visible).toBe(false)
		})

		it('does nothing for an empty selector (empty-selector guard)', () => {
			sut.targetSelector = ''
			sut.active = true
			sut.activeChanged()

			expect(sut.visible).toBe(false)
		})
	})
})
