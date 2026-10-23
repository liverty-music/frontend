import { bindable, type IDisposable, IEventAggregator, resolve } from 'aurelia'
import { Snack, type SnackAction, type SnackSeverity } from './snack'

interface SnackItem {
	id: number
	message: string
	params?: Readonly<Record<string, unknown>>
	severity: SnackSeverity
	icon: string
	action?: SnackAction
	attention: boolean
	onDismiss?: () => void
	dismissed: boolean
	dismissTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Shows `Snack` events published on the IEventAggregator at the bottom of the
 * window. Shared by the fan app and the organizer console. Each snack carries
 * its own duration (`SnackOptions.duration`, `Infinity` to stay until
 * dismissed); without one it follows the Material 3 durations
 * (`Snack.durationMs`).
 *
 * The message and the action label show as given. An app that publishes
 * catalog keys instead projects `message` and `action` slots, which receive
 * the shown snack (`$host.snack`), and translates them there.
 */
export class SnackBar {
	private readonly ea = resolve(IEventAggregator)

	/**
	 * When true, a new snack dismisses the ones shown, so only one is visible
	 * at a time (the Material 3 behavior the organizer console uses). When
	 * false (the fan app), snacks stack.
	 */
	@bindable public replace = false

	/** Shows a close button on every snack (the console's M3 snackbar). */
	@bindable public dismissible = false

	/** Accessible name of the close button. */
	@bindable public closeLabel = '閉じる'

	/** Shows the severity icon before the message (the fan app). */
	@bindable public icons = true

	public snacks: SnackItem[] = []
	private containerElement!: HTMLElement
	private nextId = 0
	private subscription!: IDisposable

	public attaching(): void {
		this.subscription = this.ea.subscribe(Snack, (event) => this.show(event))
	}

	public detaching(): void {
		for (const snack of this.snacks) {
			if (snack.dismissTimer !== null) {
				clearTimeout(snack.dismissTimer)
				snack.dismissTimer = null
			}
		}
		this.subscription.dispose()
	}

	private show(event: Snack): void {
		if (this.replace) {
			for (const shown of [...this.snacks]) this.dismiss(shown)
		}

		const id = this.nextId++
		const snack: SnackItem = {
			id,
			message: event.message,
			params: event.options?.params,
			severity: event.severity,
			icon: event.icon,
			action: event.action,
			attention: event.options?.attention ?? false,
			onDismiss: event.options?.onDismiss,
			dismissed: false,
			dismissTimer: null,
		}
		this.snacks.push(snack)

		// Populate handle so callers can programmatically dismiss
		event.handle = {
			dismiss: () => this.dismiss(snack),
		}

		// Wait for Aurelia to flush the repeat.for DOM insertion, then show popover
		queueMicrotask(() => {
			const el = this.containerElement.querySelector<HTMLElement>(
				`[data-snack-id="${id}"]`,
			)
			el?.showPopover()
		})

		// Auto-dismiss. Skip when duration is Infinity: setTimeout(fn, Infinity)
		// coerces to setTimeout(fn, 0) (ToInt32 overflow) and dismisses immediately.
		if (event.durationMs !== Infinity) {
			snack.dismissTimer = setTimeout(() => {
				snack.dismissTimer = null
				this.dismiss(snack)
			}, event.durationMs)
		}
	}

	private dismiss(snack: SnackItem): void {
		if (snack.dismissed) return
		snack.dismissed = true

		if (snack.dismissTimer !== null) {
			clearTimeout(snack.dismissTimer)
			snack.dismissTimer = null
		}

		snack.onDismiss?.()

		const el = this.containerElement.querySelector<HTMLElement>(
			`[data-snack-id="${snack.id}"]`,
		)
		if (el) {
			try {
				el.hidePopover()
			} catch {
				// Already hidden — remove directly
				this.removeSnack(snack)
			}
		} else {
			this.removeSnack(snack)
		}
	}

	private removeSnack(snack: SnackItem): void {
		const idx = this.snacks.indexOf(snack)
		if (idx !== -1) this.snacks.splice(idx, 1)
	}

	public onToggle(event: ToggleEvent, snack: SnackItem): void {
		if (event.newState === 'closed') {
			this.removeSnack(snack)
		}
	}

	public onAction(snack: SnackItem): void {
		snack.action?.callback()
		this.dismiss(snack)
	}

	public onClose(snack: SnackItem): void {
		this.dismiss(snack)
	}
}
