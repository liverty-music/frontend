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

/** Material 3 short snackbar duration (Compose `SnackbarDuration.Short`). */
export const SNACK_SHORT_MS = 4000
/** Material 3 long snackbar duration (Compose `SnackbarDuration.Long`). */
export const SNACK_LONG_MS = 10000
/** Longest message, in characters, that still gets the short duration. */
export const SNACK_SHORT_MAX_CHARS = 30

/** Typed event for triggering snack-bar notifications via IEventAggregator. */
export class Snack {
	public handle: SnackHandle | null = null

	constructor(
		public readonly message: string,
		public readonly severity: SnackSeverity = 'info',
		public readonly options?: SnackOptions,
	) {}

	/**
	 * How long the snack stays, following the Material 3 snackbar durations
	 * (Compose `SnackbarDuration.Short` 4 s / `Long` 10 s): with an action,
	 * long; without one, short for a message a reader takes in within 4 s
	 * (about 30 characters at 8 Japanese characters a second) and long
	 * beyond. A snack's own `duration` (e.g. `Infinity`) is kept.
	 *
	 * The length is the message as published. An app that publishes catalog
	 * keys translates them where it shows them, so it gives its snacks an
	 * explicit duration (the organizer console does).
	 */
	public get durationMs(): number {
		const own = this.options?.duration
		if (own !== undefined) return own
		if (this.options?.action) return SNACK_LONG_MS
		return [...this.message].length <= SNACK_SHORT_MAX_CHARS
			? SNACK_SHORT_MS
			: SNACK_LONG_MS
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
