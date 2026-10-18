export type SnackSeverity = 'info' | 'warning' | 'error'

export interface SnackAction {
	label: string
	callback: () => void
}

export interface SnackOptions {
	duration?: number
	action?: SnackAction
	onDismiss?: () => void
	/**
	 * Values for a message an app translates where it is shown: the organizer
	 * console publishes catalog keys as `message` and `action.label`, and its
	 * host translates them with these values.
	 */
	params?: Readonly<Record<string, unknown>>
	/**
	 * An `svg-icon` name shown instead of the severity's icon, or `null` for
	 * no leading icon (the fan app's update snack).
	 */
	icon?: string | null
	/**
	 * Makes the action button glow three times when the snack appears (the
	 * fan app's update snack). No glow under reduced motion.
	 */
	attention?: boolean
}

const SEVERITY_ICONS: Readonly<Record<SnackSeverity, string>> = {
	info: 'ticket',
	warning: 'warning',
	error: 'x-circle',
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

	/** The leading icon: the snack's own, the severity's, or '' for none. */
	public get icon(): string {
		const icon = this.options?.icon
		if (icon === null) return ''
		return icon ?? SEVERITY_ICONS[this.severity]
	}
}
