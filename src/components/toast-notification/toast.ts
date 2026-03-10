export type ToastSeverity = 'info' | 'warning' | 'error'

export interface ToastAction {
	label: string
	callback: () => void
}

export interface ToastOptions {
	duration?: number
	action?: ToastAction
	onDismiss?: () => void
}

export interface ToastHandle {
	dismiss(): void
}

/** Typed event for triggering toast notifications via IEventAggregator. */
export class Toast {
	public handle: ToastHandle | null = null

	constructor(
		public readonly message: string,
		public readonly severity: ToastSeverity = 'info',
		public readonly options?: ToastOptions,
	) {}

	public get durationMs(): number {
		return this.options?.duration ?? 2500
	}

	public get action(): ToastAction | undefined {
		return this.options?.action
	}
}
