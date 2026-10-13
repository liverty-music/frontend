import { DI, IEventAggregator, resolve } from 'aurelia'
import { Snack } from '../../../shared/ui/snack-bar/snack'

/** M3 snackbar durations (Compose `SnackbarHost`). */
export const SNACK_SHORT_MS = 4000
export const SNACK_LONG_MS = 10_000

/**
 * The console's one way to report the result of an action. The host
 * (`<console-snackbar>`) shows one message at a time; a new one replaces it.
 *
 * - `show`: a message without an action, gone after 4 s.
 * - `showWithAction`: a message with an action other than Retry, gone after 10 s.
 * - `showError` with `retry`: stays until the operator retries or closes it;
 *   Retry runs `retry` once and closes the message.
 *
 * A field error never comes here: it is shown under its field.
 */
export class Snackbar {
	private readonly ea = resolve(IEventAggregator)

	public show(message: string): void {
		this.ea.publish(new Snack(message, 'info', { duration: SNACK_SHORT_MS }))
	}

	public showWithAction(
		message: string,
		action: { label: string; callback: () => void },
	): void {
		this.ea.publish(
			new Snack(message, 'info', { duration: SNACK_LONG_MS, action }),
		)
	}

	public showError(
		message: string,
		retry?: { label: string; callback: () => void },
	): void {
		this.ea.publish(
			new Snack(message, 'error', {
				duration: retry ? Number.POSITIVE_INFINITY : SNACK_SHORT_MS,
				action: retry,
			}),
		)
	}
}

export const ISnackbar = DI.createInterface<ISnackbar>('ISnackbar', (x) =>
	x.singleton(Snackbar),
)
export interface ISnackbar extends Snackbar {}
