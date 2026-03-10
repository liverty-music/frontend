import { type IDisposable, IEventAggregator, resolve } from 'aurelia'
import { Toast, type ToastAction, type ToastSeverity } from './toast'

interface ToastItem {
	id: number
	message: string
	severity: ToastSeverity
	action?: ToastAction
	onDismiss?: () => void
	visible: boolean
	dismissed: boolean
	dismissTimer: ReturnType<typeof setTimeout> | null
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
			action: event.action,
			onDismiss: event.options?.onDismiss,
			visible: false,
			dismissed: false,
			dismissTimer: null,
		}
		this.toasts.push(toast)

		// Populate handle so callers can programmatically dismiss
		event.handle = {
			dismiss: () => this.dismiss(toast),
		}

		// Re-insert into Top Layer to ensure it paints above any open dialog
		if (this.toasts.length > 1) this.containerElement.hidePopover()
		this.containerElement.showPopover()

		// Trigger slide-in on next frame
		requestAnimationFrame(() => {
			toast.visible = true
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

		toast.visible = false
		toast.onDismiss?.()
		setTimeout(() => {
			const idx = this.toasts.findIndex((t) => t.id === toast.id)
			if (idx !== -1) this.toasts.splice(idx, 1)
			if (this.toasts.length === 0) {
				this.containerElement.hidePopover()
			}
		}, 400)
	}

	public onAction(toast: ToastItem): void {
		toast.action?.callback()
		this.dismiss(toast)
	}

	/** Returns the gradient CSS classes for a toast's severity. */
	public severityClass(severity: ToastSeverity): string {
		return SEVERITY_CLASSES[severity]
	}
}
