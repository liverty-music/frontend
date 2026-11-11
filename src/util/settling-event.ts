/**
 * The detail of an event whose handler may need time: the handler passes the
 * promise of its work to `waitUntil`, and the element that dispatched the event
 * keeps its control busy until that promise settles.
 */
export interface SettlingEventDetail {
	waitUntil(work: Promise<unknown>): void
}

/**
 * Dispatches a bubbling `CustomEvent` from `host` and returns the promise a
 * handler registered through `waitUntil`, or `undefined` when none did. Return
 * it from a `busy-on-click` handler to keep the control busy while the parent
 * works.
 */
export function dispatchSettling<T extends object = Record<never, never>>(
	host: HTMLElement,
	name: string,
	detail?: T,
): Promise<unknown> | undefined {
	let pending: Promise<unknown> | undefined
	host.dispatchEvent(
		new CustomEvent<SettlingEventDetail & T>(name, {
			bubbles: true,
			detail: {
				...(detail as T),
				waitUntil: (work) => {
					pending = work
				},
			},
		}),
	)
	return pending
}
