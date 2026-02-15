import { DI } from 'aurelia'

interface ToastItem {
	id: number
	message: string
	visible: boolean
}

export const IToastService = DI.createInterface<IToastService>(
	'IToastService',
	(x) => x.singleton(ToastNotification),
)

export interface IToastService extends ToastNotification {}

export class ToastNotification {
	public toasts: ToastItem[] = []
	private nextId = 0

	public show(message: string, durationMs = 2500): void {
		const id = this.nextId++
		const toast: ToastItem = { id, message, visible: false }
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
}
