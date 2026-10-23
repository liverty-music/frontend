import { DI, IEventAggregator, resolve } from 'aurelia'
import {
	SNACK_LONG_MS,
	SNACK_SHORT_MS,
	Snack,
} from '../../../shared/ui/snack-bar/snack'

// M3 snackbar durations, shared with the fan app's snack-bar. The console
// passes them explicitly: its messages are catalog keys, so their length is
// not the length the member reads.
export { SNACK_LONG_MS, SNACK_SHORT_MS }

/** Values of a catalog message. */
export type MessageParams = Record<string, unknown>

/**
 * The console's one way to report the result of an action. Messages are
 * catalog keys with their values; the host (`<console-snackbar>`) translates
 * them in its template, so a message shown while the language changes follows
 * the switch (design D17). The host shows one message at a time; a new one
 * replaces it, and none carries an icon (design D18).
 *
 * - `show`: a message without an action, gone after 4 s.
 * - `showWithAction`: a message with an action other than Retry, gone after 10 s.
 * - `showError` with `retry`: stays until the member retries or closes it;
 *   再試行 runs `retry` once and closes the message.
 *
 * A field error never comes here: it is shown under its field.
 */
export class Snackbar {
	private readonly ea = resolve(IEventAggregator)

	public show(key: string, params?: MessageParams): void {
		this.ea.publish(
			new Snack(key, 'info', { duration: SNACK_SHORT_MS, params }),
		)
	}

	public showWithAction(
		key: string,
		action: { labelKey: string; callback: () => void },
		params?: MessageParams,
	): void {
		this.ea.publish(
			new Snack(key, 'info', {
				duration: SNACK_LONG_MS,
				action: { label: action.labelKey, callback: action.callback },
				params,
			}),
		)
	}

	public showError(
		key: string,
		options: { params?: MessageParams; retry?: () => void } = {},
	): void {
		const { params, retry } = options
		this.ea.publish(
			new Snack(key, 'error', {
				duration: retry ? Number.POSITIVE_INFINITY : SNACK_SHORT_MS,
				action: retry ? { label: 'common.retry', callback: retry } : undefined,
				params,
			}),
		)
	}
}

export const ISnackbar = DI.createInterface<ISnackbar>('ISnackbar', (x) =>
	x.singleton(Snackbar),
)
export interface ISnackbar extends Snackbar {}
