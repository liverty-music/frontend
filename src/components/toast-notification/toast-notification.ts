import { DI } from 'aurelia'

export type ToastSeverity = 'info' | 'warning' | 'error'

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

export const IToastService = DI.createInterface<IToastService>(
	'IToastService',
	(x) => x.singleton(ToastNotification),
)

export interface IToastService extends ToastNotification {}

export class ToastNotification {
	public toasts: ToastItem[] = []
	private nextId = 0

	public show(
		message: string,
		severity: ToastSeverity = 'info',
		durationMs = 2500,
	): void {
		const id = this.nextId++
		const toast: ToastItem = { id, message, severity, visible: false }
		this.toasts.push(toast)

		// Trigger slide-in on next frame
		requestAnimationFrame(() => {
			toast.visible = true
		})

		// Auto-dismiss
		setTimeout(() => {
			toast.visible = false
			setTimeout(() => {
				this.toasts = this.toasts.filter((t) => t.id !== id)
			}, 400)
		}, durationMs)
	}

	/** Returns the gradient CSS classes for a toast's severity. */
	public severityClass(severity: ToastSeverity): string {
		return SEVERITY_CLASSES[severity]
	}
}
