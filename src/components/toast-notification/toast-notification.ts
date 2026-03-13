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

export class ToastNotification {
	private readonly ea = resolve(IEventAggregator)

	public toasts: ToastItem[] = []
	private containerElement!: HTMLElement
	private nextId = 0
	private subscription!: IDisposable
	private readonly boundTransitionEnd = (e: TransitionEvent) =>
		this.onTransitionEnd(e)

	public attaching(): void {
		this.subscription = this.ea.subscribe(Toast, (event) => this.show(event))
	}

	public attached(): void {
		this.containerElement.addEventListener(
			'transitionend',
			this.boundTransitionEnd,
		)
	}

	public detaching(): void {
		this.containerElement.removeEventListener(
			'transitionend',
			this.boundTransitionEnd,
		)
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
			visible: true,
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

		// When transitions are disabled (prefers-reduced-motion: reduce),
		// transitionend never fires — remove the toast immediately.
		if (this.prefersReducedMotion()) {
			this.removeToast(toast)
		}
	}

	private removeToast(toast: ToastItem): void {
		const idx = this.toasts.indexOf(toast)
		if (idx !== -1) this.toasts.splice(idx, 1)
		if (this.toasts.length === 0) {
			this.containerElement.hidePopover()
		}
	}

	private prefersReducedMotion(): boolean {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches
	}

	private onTransitionEnd(e: TransitionEvent): void {
		if (e.propertyName !== 'opacity') return
		const target = e.target as HTMLElement
		const idStr = target.dataset.toastId
		if (!idStr) return

		const id = Number(idStr)
		const toast = this.toasts.find((t) => t.id === id)
		if (!toast || toast.visible) return

		this.removeToast(toast)
	}

	public onAction(toast: ToastItem): void {
		toast.action?.callback()
		this.dismiss(toast)
	}
}
