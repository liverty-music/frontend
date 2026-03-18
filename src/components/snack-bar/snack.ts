export type SnackSeverity = 'info' | 'warning' | 'error'

export interface SnackAction {
	label: string
	callback: () => void
}

export interface SnackOptions {
	duration?: number
	action?: SnackAction
	onDismiss?: () => void
}

export interface SnackHandle {
	dismiss(): void
}

/** Typed event for triggering snack-bar notifications via IEventAggregator. */
export class Snack {
	public handle: SnackHandle | null = null

	constructor(
		public readonly message: string,
		public readonly severity: SnackSeverity = 'info',
		public readonly options?: SnackOptions,
	) {}

	public get durationMs(): number {
		return this.options?.duration ?? 2500
	}

	public get action(): SnackAction | undefined {
		return this.options?.action
	}
}
