import { bindable, type IDisposable, IEventAggregator, resolve } from 'aurelia'
import { Snack } from './snack'

/**
 * Shows `Snack` events published on the IEventAggregator at the bottom of the
 * window, one at a time, as Material 3 says ("Only one snackbar may be
 * displayed at a time"). Shared by the fan app and the organizer console.
 *
 * A snack published while another is shown waits, and waiting snacks appear
 * in the order they were published, each after the one before it has finished
 * its exit motion. A snack with the `replaceKey` of a shown snack dismisses it
 * and appears next; one with the key of a waiting snack takes its place in the
 * wait. A snack that stays until the person acts (`duration: Infinity`, the
 * fan app's update snack) gives way to any other: it leaves without being
 * dismissed and is shown again once nothing else is shown or waiting.
 *
 * Each snack carries its own duration (`SnackOptions.duration`); without one
 * it follows the Material 3 durations (`Snack.durationMs`). The shown snack's
 * timer, motion and swipe belong to its `<snack-item>`.
 *
 * The message and the action label show as given. An app that publishes
 * catalog keys instead projects `message` and `action` slots, which receive
 * the shown snack (`$host.snack`), and translates them there.
 */
export class SnackBar {
	private readonly ea = resolve(IEventAggregator)

	/**
	 * When true, a new snack dismisses the shown one and every waiting one, so
	 * the newest message is the next one shown (the organizer console).
	 */
	@bindable public replace = false

	/** Shows a close button on every snack (the console's M3 snackbar). */
	@bindable public dismissible = false

	/** Accessible name of the close button. */
	@bindable public closeLabel = '閉じる'

	/** Shows the severity icon before the message (the fan app). */
	@bindable public icons = true

	/** The shown snack, as a list of zero or one for the template. */
	public snacks: Snack[] = []
	/** The shown snack is leaving: dismissed, or giving way to another. */
	public leaving = false

	/** Snacks waiting to be shown, oldest first. */
	private queue: Snack[] = []
	/** A snack that stays until the person acts, set aside for the others. */
	private parked: Snack | null = null
	/** Snacks whose dismissal has been handled (`onDismiss` called). */
	private readonly settled = new WeakSet<Snack>()
	private subscription!: IDisposable

	public get shown(): Snack | null {
		return this.snacks[0] ?? null
	}

	public attaching(): void {
		this.subscription = this.ea.subscribe(Snack, (event) => this.publish(event))
	}

	public detaching(): void {
		this.subscription.dispose()
	}

	/** The shown snack's item has finished its exit motion. */
	public onExited(snack: Snack): void {
		if (snack !== this.shown) return
		this.snacks = []
		this.leaving = false
		this.showNext()
	}

	private publish(event: Snack): void {
		event.handle = { dismiss: () => this.dismiss(event) }

		if (this.replace) {
			for (const waiting of this.queue) this.settle(waiting)
			this.queue = [event]
			if (this.shown) this.dismiss(this.shown)
		} else {
			this.enqueue(event)
		}
		this.giveWay()
		this.showNext()
	}

	private enqueue(event: Snack): void {
		const key = event.replaceKey
		if (key !== undefined && this.shown?.replaceKey === key) {
			// It takes the shown snack's place: next, before any waiting one.
			this.queue.unshift(event)
			this.dismiss(this.shown)
			return
		}
		const waiting =
			key === undefined
				? -1
				: this.queue.findIndex((queued) => queued.replaceKey === key)
		if (waiting === -1) {
			this.queue.push(event)
			return
		}
		const replaced = this.queue[waiting]
		this.queue[waiting] = event
		this.settle(replaced)
	}

	/**
	 * A shown snack that stays until the person acts leaves for a waiting one,
	 * without being dismissed, and waits to be shown again.
	 */
	private giveWay(): void {
		const shown = this.shown
		if (
			shown === null ||
			this.leaving ||
			this.queue.length === 0 ||
			this.parked !== null ||
			Number.isFinite(shown.durationMs)
		) {
			return
		}
		this.parked = shown
		this.leaving = true
	}

	private showNext(): void {
		if (this.shown) return
		let next = this.queue.shift()
		if (!next && this.parked) {
			next = this.parked
			this.parked = null
		}
		if (!next) return
		this.snacks = [next]
		this.giveWay()
	}

	private dismiss(snack: Snack): void {
		if (this.settled.has(snack)) return
		this.settle(snack)
		const waiting = this.queue.indexOf(snack)
		if (waiting !== -1) {
			this.queue.splice(waiting, 1)
			return
		}
		// A parked snack is either waiting aside or still leaving; either way
		// it must not come back.
		if (snack === this.parked) {
			this.parked = null
			return
		}
		if (snack === this.shown) this.leaving = true
	}

	/** Calls a snack's `onDismiss` once, whichever path dismissed it. */
	private settle(snack: Snack): void {
		if (this.settled.has(snack)) return
		this.settled.add(snack)
		snack.options?.onDismiss?.()
	}
}
