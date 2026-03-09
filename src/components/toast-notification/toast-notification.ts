import { type IDisposable, IEventAggregator, resolve } from 'aurelia'
import { Toast, type ToastSeverity } from './toast'

interface ToastItem {
	id: number
	message: string
	severity: ToastSeverity
	visible: boolean
}

/** CSS class mapping for toast severity levels. */
const SEVERITY_CLASSES: Record<ToastSeverity, string> = {
	info: 'from-brand-primary to-brand-secondary',
	warning: 'from-amber-600 to-amber-500',
	error: 'from-red-700 to-red-600',
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
			visible: false,
		}
		this.toasts.push(toast)

		// Re-insert into Top Layer to ensure it paints above any open dialog
		if (this.toasts.length > 1) this.containerElement.hidePopover()
		this.containerElement.showPopover()

		// Trigger slide-in on next frame
		requestAnimationFrame(() => {
			toast.visible = true
		})

		// Auto-dismiss
		setTimeout(() => {
			toast.visible = false
			setTimeout(() => {
				const idx = this.toasts.findIndex((t) => t.id === id)
				if (idx !== -1) this.toasts.splice(idx, 1)
				if (this.toasts.length === 0) {
					this.containerElement.hidePopover()
				}
			}, 400)
		}, event.durationMs)
	}

	/** Returns the gradient CSS classes for a toast's severity. */
	public severityClass(severity: ToastSeverity): string {
		return SEVERITY_CLASSES[severity]
	}
}
