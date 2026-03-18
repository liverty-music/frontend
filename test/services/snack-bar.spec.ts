import { DI, IEventAggregator, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../src/components/snack-bar/snack'
import { SnackBar } from '../../src/components/snack-bar/snack-bar'

// jsdom does not provide ToggleEvent — polyfill for tests
if (typeof globalThis.ToggleEvent === 'undefined') {
	;(globalThis as any).ToggleEvent = class ToggleEvent extends Event {
		public readonly newState: string
		public readonly oldState: string
		constructor(type: string, init: { newState: string; oldState: string }) {
			super(type)
			this.newState = init.newState
			this.oldState = init.oldState
		}
	}
}

function createToggleEvent(newState: 'open' | 'closed'): ToggleEvent {
	return new ToggleEvent('toggle', {
		newState,
		oldState: newState === 'closed' ? 'open' : 'closed',
	})
}

function createMockSnackElement(): HTMLElement {
	const el = document.createElement('div')
	;(el as any).showPopover = vi.fn()
	;(el as any).hidePopover = vi.fn()
	return el
}

describe('SnackBar', () => {
	let sut: SnackBar
	let ea: IEventAggregator
	let publishSnack: (event: Snack) => void
	let hostElement: HTMLElement
	let mockContainer: HTMLElement

	beforeEach(() => {
		vi.useFakeTimers()

		hostElement = document.createElement('div')

		const container = DI.createContainer()
		container.register(Registration.instance(INode, hostElement), SnackBar)
		ea = container.get(IEventAggregator)
		sut = container.get(SnackBar)

		// Container element that holds snack children
		mockContainer = document.createElement('div')
		;(sut as any).containerElement = mockContainer

		sut.attaching()

		publishSnack = (event: Snack) => ea.publish(event)
	})

	afterEach(() => {
		sut.detaching()
		vi.restoreAllMocks()
	})

	/** Insert a mock popover element into the container to simulate Aurelia repeat.for rendering. */
	function insertMockElement(snackId: number): HTMLElement {
		const el = createMockSnackElement()
		el.dataset.snackId = String(snackId)
		mockContainer.appendChild(el)
		return el
	}

	it('should add snack to array on publish', () => {
		publishSnack(new Snack('Test message'))

		expect(sut.snacks).toHaveLength(1)
		expect(sut.snacks[0].message).toBe('Test message')
	})

	it('should call showPopover after microtask flush', async () => {
		publishSnack(new Snack('Test message'))
		const el = insertMockElement(0)

		// Flush the queueMicrotask
		await Promise.resolve()

		expect(el.showPopover).toHaveBeenCalledOnce()
	})

	it('should auto-dismiss snack after duration', () => {
		publishSnack(new Snack('Test message', 'info', { duration: 2500 }))
		insertMockElement(0)

		expect(sut.snacks[0].dismissed).toBe(false)

		vi.advanceTimersByTime(2500)
		expect(sut.snacks[0].dismissed).toBe(true)
	})

	it('should remove snack on toggle event after hidePopover', () => {
		publishSnack(new Snack('Test message', 'info', { duration: 2500 }))
		insertMockElement(0)

		expect(sut.snacks).toHaveLength(1)

		vi.advanceTimersByTime(2500)
		// Snack is dismissed but still in array (awaiting toggle)
		expect(sut.snacks).toHaveLength(1)

		// Simulate the popover closing (browser fires toggle after exit transition)
		sut.onToggle(createToggleEvent('closed'), sut.snacks[0])

		expect(sut.snacks).toHaveLength(0)
	})

	it('should dismiss via handle', () => {
		const onDismiss = vi.fn()
		const snack = new Snack('Test', 'info', { onDismiss })
		publishSnack(snack)
		insertMockElement(0)

		snack.handle!.dismiss()

		expect(onDismiss).toHaveBeenCalledOnce()
		expect(sut.snacks[0].dismissed).toBe(true)
	})

	it('should not double-dismiss', () => {
		const onDismiss = vi.fn()
		const snack = new Snack('Test', 'info', { onDismiss })
		publishSnack(snack)
		insertMockElement(0)

		snack.handle!.dismiss()
		snack.handle!.dismiss()

		expect(onDismiss).toHaveBeenCalledOnce()
	})

	it('should handle multiple snacks with unique IDs', () => {
		publishSnack(new Snack('Message 1'))
		publishSnack(new Snack('Message 2'))
		publishSnack(new Snack('Message 3'))

		expect(sut.snacks).toHaveLength(3)
		expect(sut.snacks[0].id).toBe(0)
		expect(sut.snacks[1].id).toBe(1)
		expect(sut.snacks[2].id).toBe(2)
	})

	it('should use default duration if not specified', () => {
		publishSnack(new Snack('Test message'))
		insertMockElement(0)

		vi.advanceTimersByTime(2500)
		expect(sut.snacks[0].dismissed).toBe(true)
	})

	it('should remove snack from array on toggle close (no container hidePopover needed)', () => {
		publishSnack(new Snack('Test message'))
		insertMockElement(0)

		vi.advanceTimersByTime(2500)
		sut.onToggle(createToggleEvent('closed'), sut.snacks[0])

		expect(sut.snacks).toHaveLength(0)
	})

	it('should dismiss multiple snacks independently without interference', () => {
		publishSnack(new Snack('A', 'info', { duration: 1000 }))
		publishSnack(new Snack('B', 'info', { duration: 2000 }))
		publishSnack(new Snack('C', 'info', { duration: 3000 }))
		insertMockElement(0)
		insertMockElement(1)
		insertMockElement(2)

		// Dismiss A
		vi.advanceTimersByTime(1000)
		expect(sut.snacks[0].dismissed).toBe(true)
		expect(sut.snacks[1].dismissed).toBe(false)
		expect(sut.snacks[2].dismissed).toBe(false)

		// Toggle removes A
		const snackA = sut.snacks[0]
		sut.onToggle(createToggleEvent('closed'), snackA)
		expect(sut.snacks).toHaveLength(2)

		// B and C still alive
		expect(sut.snacks[0].message).toBe('B')
		expect(sut.snacks[1].message).toBe('C')

		// Dismiss B
		vi.advanceTimersByTime(1000)
		expect(sut.snacks[0].dismissed).toBe(true)
		expect(sut.snacks[1].dismissed).toBe(false)
	})
})
