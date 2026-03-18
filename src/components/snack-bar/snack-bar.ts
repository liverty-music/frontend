import { type IDisposable, IEventAggregator, resolve } from 'aurelia'
import { Snack, type SnackAction, type SnackSeverity } from './snack'

interface SnackItem {
	id: number
	message: string
	severity: SnackSeverity
	action?: SnackAction
	onDismiss?: () => void
	dismissed: boolean
	dismissTimer: ReturnType<typeof setTimeout> | null
}

export class SnackBar {
	private readonly ea = resolve(IEventAggregator)

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
		const id = this.nextId++
		const snack: SnackItem = {
			id,
			message: event.message,
			severity: event.severity,
			action: event.action,
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

		// Auto-dismiss
		snack.dismissTimer = setTimeout(() => {
			snack.dismissTimer = null
			this.dismiss(snack)
		}, event.durationMs)
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
}
