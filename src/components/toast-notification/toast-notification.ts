import { type IDisposable, IEventAggregator, resolve } from 'aurelia'
import { Toast, type ToastAction, type ToastSeverity } from './toast'

interface ToastItem {
	id: number
	message: string
	severity: ToastSeverity
	action?: ToastAction
	onDismiss?: () => void
	dismissed: boolean
	dismissTimer: ReturnType<typeof setTimeout> | null
}

export class ToastNotification {
	private readonly ea = resolve(IEventAggregator)

	public toasts: ToastItem[] = []
	private containerElement!: HTMLElement
	private nextId = 0
	private subscription!: IDisposable

	public attaching(): void {
		this.subscription = this.ea.subscribe(Toast, (event) => this.show(event))
	}

	public detaching(): void {
		this.subscription.dispose()
	}

	private show(event: Toast): void {
		const id = this.nextId++
		const toast: ToastItem = {
			id,
			message: event.message,
			severity: event.severity,
			action: event.action,
			onDismiss: event.options?.onDismiss,
			dismissed: false,
			dismissTimer: null,
		}
		this.toasts.push(toast)

		// Populate handle so callers can programmatically dismiss
		event.handle = {
			dismiss: () => this.dismiss(toast),
		}

		// Wait for Aurelia to flush the repeat.for DOM insertion, then show popover
		queueMicrotask(() => {
			const el = this.containerElement.querySelector<HTMLElement>(
				`[data-toast-id="${id}"]`,
			)
			el?.showPopover()
		})

		// Auto-dismiss
		toast.dismissTimer = setTimeout(() => {
			toast.dismissTimer = null
			this.dismiss(toast)
		}, event.durationMs)
	}

	private dismiss(toast: ToastItem): void {
		if (toast.dismissed) return
		toast.dismissed = true

		if (toast.dismissTimer !== null) {
			clearTimeout(toast.dismissTimer)
			toast.dismissTimer = null
		}

		toast.onDismiss?.()

		const el = this.containerElement.querySelector<HTMLElement>(
			`[data-toast-id="${toast.id}"]`,
		)
		if (el) {
			try {
				el.hidePopover()
			} catch {
				// Already hidden — remove directly
				this.removeToast(toast)
			}
		} else {
			this.removeToast(toast)
		}
	}

	private removeToast(toast: ToastItem): void {
		const idx = this.toasts.indexOf(toast)
		if (idx !== -1) this.toasts.splice(idx, 1)
	}

	public onToggle(event: ToggleEvent, toast: ToastItem): void {
		if (event.newState === 'closed') {
			this.removeToast(toast)
		}
	}

	public onAction(toast: ToastItem): void {
		toast.action?.callback()
		this.dismiss(toast)
	}
}
