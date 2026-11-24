import { queueTask } from 'aurelia'
import { afterEach, describe, expect, it } from 'vitest'
import { inListTransition } from './list-transition'

const root = document.documentElement

/** A View Transition whose `finished` the test settles by hand. */
function fakeTransition(change: () => void) {
	let finish!: () => void
	const finished = new Promise<void>((resolve) => {
		finish = resolve
	})
	change()
	return {
		transition: {
			ready: Promise.resolve(),
			finished,
			updateCallbackDone: Promise.resolve(),
		},
		finish,
	}
}

describe('inListTransition', () => {
	const original = document.startViewTransition

	afterEach(() => {
		Object.assign(document, { startViewTransition: original })
		root.classList.remove('vt-suppress-root')
	})

	it('makes the edit at once where there are no View Transitions', async () => {
		Object.assign(document, { startViewTransition: undefined })
		let made = false
		await inListTransition(() => {
			made = true
		})
		expect(made).toBe(true)
		expect(root.classList).not.toContain('vt-suppress-root')
	})

	it('holds the root cross-fade off until its transition ends', async () => {
		const settle: Array<() => void> = []
		Object.assign(document, {
			startViewTransition: (change: () => void) => {
				const { transition, finish } = fakeTransition(change)
				settle.push(finish)
				return transition
			},
		})
		await inListTransition(() => {})
		expect(root.classList).toContain('vt-suppress-root')
		settle[0]()
		await Promise.resolve()
		await Promise.resolve()
		expect(root.classList).not.toContain('vt-suppress-root')
	})

	it('keeps the class while a newer transition runs after one is skipped', async () => {
		const settle: Array<() => void> = []
		Object.assign(document, {
			startViewTransition: (change: () => void) => {
				const { transition, finish } = fakeTransition(change)
				settle.push(finish)
				return transition
			},
		})
		await inListTransition(() => {})
		await inListTransition(() => {})
		// The first is skipped by the second and finishes first.
		settle[0]()
		await Promise.resolve()
		await Promise.resolve()
		expect(root.classList).toContain('vt-suppress-root')
		settle[1]()
		await Promise.resolve()
		await Promise.resolve()
		expect(root.classList).not.toContain('vt-suppress-root')
	})

	it("flushes Aurelia's queued writes inside the transition's callback", async () => {
		let flushed = false
		Object.assign(document, {
			startViewTransition: (change: () => void) => {
				const { transition } = fakeTransition(change)
				// The callback has returned: its queued writes must be done.
				expect(flushed).toBe(true)
				return transition
			},
		})
		await inListTransition(() => {
			queueTask(() => {
				flushed = true
			})
		})
	})
})
