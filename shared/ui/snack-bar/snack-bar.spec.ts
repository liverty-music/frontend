import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeSubscription = { dispose: vi.fn() }
let subscribeHandler: ((e: unknown) => void) | undefined
const fakeEa = {
	subscribe: vi.fn((_channel: unknown, handler: (e: unknown) => void) => {
		subscribeHandler = handler
		return fakeSubscription
	}),
	publish: vi.fn(),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => fakeEa),
	}
})

import { Snack, type SnackOptions } from './snack'
import { SnackBar } from './snack-bar'

const SPEC = 'components/infrastructure/fan/web/global/snack-bar'

describe('SnackBar', () => {
	let sut: SnackBar

	/** Publish a snack as a sender does, through the event aggregator. */
	function publish(message: string, options?: SnackOptions): Snack {
		const snack = new Snack(message, 'info', options)
		subscribeHandler?.(snack)
		return snack
	}

	/** The shown snack's item reports that its exit motion has ended. */
	function exit(): void {
		const shown = sut.shown
		if (shown) sut.onExited(shown)
	}

	/** The messages in the order they are shown, each after the last exits. */
	function showOrder(): string[] {
		const order: string[] = []
		while (sut.shown) {
			order.push(sut.shown.message)
			sut.shown.handle?.dismiss()
			exit()
		}
		return order
	}

	beforeEach(() => {
		subscribeHandler = undefined
		vi.clearAllMocks()
		sut = new SnackBar()
		sut.attaching()
	})

	describe('lifecycle', () => {
		it('subscribes to Snack events while attached', () => {
			expect(fakeEa.subscribe).toHaveBeenCalledWith(Snack, expect.any(Function))
			sut.detaching()
			expect(fakeSubscription.dispose).toHaveBeenCalledOnce()
		})
	})

	// @spec components/infrastructure/fan/web/global/snack-bar "Snack display on event publish"
	it('shows a published snack at once when none is shown', () => {
		const snack = publish('Hello')

		expect(sut.snacks).toEqual([snack])
		expect(sut.leaving).toBe(false)
	})

	describe('one at a time', () => {
		it(`@spec ${SPEC} "A second snack waits"`, () => {
			publish('first')
			publish('second')

			// Only the first is shown; the second waits.
			expect(sut.snacks.map((s) => s.message)).toEqual(['first'])
			sut.shown?.handle?.dismiss()
			// Dismissed, it stays shown while its exit motion plays.
			expect(sut.snacks.map((s) => s.message)).toEqual(['first'])
			expect(sut.leaving).toBe(true)
			exit()
			expect(sut.snacks.map((s) => s.message)).toEqual(['second'])
			expect(sut.leaving).toBe(false)
		})

		it(`@spec ${SPEC} "Waiting snacks keep their order"`, () => {
			publish('one')
			publish('two')
			publish('three')

			expect(showOrder()).toEqual(['one', 'two', 'three'])
		})

		// @spec components/infrastructure/fan/web/global/snack-bar "Multiple simultaneous snacks"
		it('never shows two snacks, however many are published', () => {
			for (const m of ['1', '2', '3', '4', '5']) publish(m)

			expect(sut.snacks).toHaveLength(1)
			expect(showOrder()).toEqual(['1', '2', '3', '4', '5'])
		})

		it(`@spec ${SPEC} "An undo window is kept"`, () => {
			const commit = vi.fn()
			publish('YOASOBIのフォローを解除しました', {
				onDismiss: commit,
				action: { label: '元に戻す', callback: () => {} },
			})
			publish('Vaundy: Home', { replaceKey: 'hype:vaundy' })

			// The undo snack stays, with its action, until its own time ends.
			expect(sut.shown?.message).toBe('YOASOBIのフォローを解除しました')
			expect(sut.shown?.durationMs).toBe(10_000)
			expect(commit).not.toHaveBeenCalled()
			expect(showOrder()).toEqual([
				'YOASOBIのフォローを解除しました',
				'Vaundy: Home',
			])
			expect(commit).toHaveBeenCalledOnce()
		})
	})

	describe('replaceKey', () => {
		it(`@spec ${SPEC} "Replacing an earlier snack"`, () => {
			const earlier = publish('artist-1 first', { replaceKey: 'hype:artist-1' })
			publish('other')
			publish('artist-1 second', { replaceKey: 'hype:artist-1' })

			// The shown one is dismissed, and the new one comes next.
			expect(sut.shown).toBe(earlier)
			expect(sut.leaving).toBe(true)
			exit()
			expect(showOrder()).toEqual(['artist-1 second', 'other'])
		})

		it('replaces a waiting snack where it waits', () => {
			const dropped = vi.fn()
			publish('shown')
			publish('artist-1 first', {
				replaceKey: 'hype:artist-1',
				onDismiss: dropped,
			})
			publish('other')
			publish('artist-1 second', { replaceKey: 'hype:artist-1' })

			expect(dropped).toHaveBeenCalledOnce()
			expect(showOrder()).toEqual(['shown', 'artist-1 second', 'other'])
		})
	})

	describe('handle', () => {
		// @spec components/infrastructure/fan/web/global/snack-bar "Programmatic dismiss via handle"
		it('makes a shown snack leave and calls onDismiss once', () => {
			const onDismiss = vi.fn()
			const snack = publish('Saved', { onDismiss })

			snack.handle?.dismiss()
			snack.handle?.dismiss()

			expect(sut.leaving).toBe(true)
			expect(onDismiss).toHaveBeenCalledOnce()
		})

		it(`@spec ${SPEC} "Dismissing a waiting snack"`, () => {
			const onDismiss = vi.fn()
			publish('shown')
			const waiting = publish('waiting', { onDismiss })

			waiting.handle?.dismiss()
			waiting.handle?.dismiss()

			expect(onDismiss).toHaveBeenCalledOnce()
			expect(showOrder()).toEqual(['shown'])
		})

		// @spec components/infrastructure/fan/web/global/snack-bar "DOM cleanup after exit transition"
		it('keeps a dismissed snack until its item reports the exit has ended', () => {
			const snack = publish('Saved')
			snack.handle?.dismiss()

			expect(sut.snacks).toEqual([snack])
			sut.onExited(snack)
			expect(sut.snacks).toEqual([])
		})
	})

	describe('a snack that stays until the fan acts', () => {
		const update = () =>
			publish('新しいバージョンがあります', {
				duration: Number.POSITIVE_INFINITY,
				action: { label: '更新', callback: () => {} },
			})

		it(`@spec ${SPEC} "The update snack gives way"`, () => {
			const applied = vi.fn()
			const snack = new Snack('新しいバージョンがあります', 'info', {
				duration: Number.POSITIVE_INFINITY,
				onDismiss: applied,
				action: { label: '更新', callback: () => {} },
			})
			subscribeHandler?.(snack)
			publish('BAND 1をフォローしました')

			// It leaves without being dismissed.
			expect(sut.shown).toBe(snack)
			expect(sut.leaving).toBe(true)
			exit()
			expect(sut.shown?.message).toBe('BAND 1をフォローしました')
			sut.shown?.handle?.dismiss()
			exit()
			// Back once nothing else is shown or waiting, never applied or lost.
			expect(sut.shown).toBe(snack)
			expect(sut.leaving).toBe(false)
			expect(applied).not.toHaveBeenCalled()
		})

		it('waits behind every snack published while it is aside', () => {
			update()
			publish('one')
			exit()
			publish('two')

			expect(showOrder()).toEqual(['one', 'two', '新しいバージョンがあります'])
		})

		it('does not come back once dismissed while aside', () => {
			const snack = update()
			publish('one')
			snack.handle?.dismiss()
			exit()

			expect(showOrder()).toEqual(['one'])
		})
	})

	describe('replace mode (the organizer console)', () => {
		it('dismisses the shown and every waiting snack; the newest is next', () => {
			sut.replace = true
			const onDismiss = vi.fn()
			publish('saved', { onDismiss })
			const waiting = vi.fn()
			publish('copied', { onDismiss: waiting })
			publish('deleted')

			expect(onDismiss).toHaveBeenCalledOnce()
			expect(waiting).toHaveBeenCalledOnce()
			expect(sut.leaving).toBe(true)
			exit()
			expect(showOrder()).toEqual(['deleted'])
		})
	})
})
