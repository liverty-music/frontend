export type ToastSeverity = 'info' | 'warning' | 'error'

/** Typed event for triggering toast notifications via IEventAggregator. */
export class Toast {
	constructor(
		public readonly message: string,
		public readonly severity: ToastSeverity = 'info',
		public readonly durationMs: number = 2500,
	) {}
}
