import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A real DOM element so the attribute can attach listeners and inject ripples.
let element: HTMLButtonElement

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		// The only dependency the attribute resolves is INode.
		resolve: vi.fn(() => element),
	}
})

import { PressFeedbackCustomAttribute } from './press-feedback'

/** Dispatch a pointerdown carrying contact-point coordinates. */
function pointerDown(el: HTMLElement, x: number, y: number): void {
	el.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y }))
}

describe('PressFeedbackCustomAttribute', () => {
	let sut: PressFeedbackCustomAttribute

	beforeEach(() => {
		vi.clearAllMocks()
		element = document.createElement('button')
		// jsdom returns a zero-sized rect by default; give the element real bounds
		// so the ripple geometry is computed instead of early-returning.
		element.getBoundingClientRect = () =>
			({ left: 0, top: 0, width: 100, height: 40 }) as DOMRect
		sut = new PressFeedbackCustomAttribute()
		sut.attached()
	})

	afterEach(() => {
		sut.detaching()
	})

	it('marks the element with data-press-feedback on attach', () => {
		expect(element.hasAttribute('data-press-feedback')).toBe(true)
	})

	it('spawns a contact-point ripple inside a clip container on pointerdown', () => {
		pointerDown(element, 50, 20)

		const container = element.querySelector('.press-ripple-container')
		expect(container).not.toBeNull()
		const ripple = container?.querySelector('.press-ripple') as HTMLElement
		expect(ripple).not.toBeNull()
		// Geometry is set from the contact point (non-empty custom props).
		expect(ripple.style.getPropertyValue('--ripple-size')).not.toBe('')
	})

	it('keeps the interactive element itself unchanged in size (overlay-only)', () => {
		pointerDown(element, 10, 10)
		// The ripple lives in an absolutely-positioned overlay child, never
		// resizing the host or its children beyond the overlay.
		expect(element.querySelectorAll('.press-ripple-container')).toHaveLength(1)
	})

	it('removes the ripple overlay and attribute on detach', () => {
		pointerDown(element, 50, 20)
		sut.detaching()

		expect(element.querySelector('.press-ripple-container')).toBeNull()
		expect(element.hasAttribute('data-press-feedback')).toBe(false)
	})

	it('spawns a ripple on keyboard activation (Enter) for non-pointer users', () => {
		element.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
		)
		expect(element.querySelector('.press-ripple')).not.toBeNull()
	})

	it('does not throw for a zero-sized element (no ripple)', () => {
		element.getBoundingClientRect = () =>
			({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect

		expect(() => pointerDown(element, 0, 0)).not.toThrow()
		expect(element.querySelector('.press-ripple')).toBeNull()
	})
})
