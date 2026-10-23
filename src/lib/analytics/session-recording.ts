import type { SessionRecordingOptions } from 'posthog-js'
import { stripUrl } from './strip-own-url-query'

/**
 * Route elements of the screens that are never recorded: the checkout, the
 * lottery entry and its status, the identity check and Settings (with its
 * passkeys screen). Blocking a route element replaces the whole screen with
 * an empty box in the recording. The PostHog project's URL blocklist pauses
 * recording on the same addresses (runbook `posthog-project-settings.md`).
 */
export const UNRECORDED_SCREENS = [
	'checkout-route',
	'lottery-entry-route',
	'lottery-entry-status-route',
	'verify-callback-route',
	'settings-route',
	'passkeys-route',
] as const

/**
 * Session recording options (OpenSpec `global/analytics`, "Session
 * recordings hide what the fan types and reads"):
 *   - every text and every input value is masked, password fields included;
 *   - hidden inputs, whose values rrweb records even with `maskAllInputs`,
 *     are blocked;
 *   - the screens in {@link UNRECORDED_SCREENS} are blocked;
 *   - the addresses the recording carries (page `href`s, network entries)
 *     lose their query and fragment on the app's own origin, as events do,
 *     so a referral code never leaves the device.
 */
export function sessionRecordingOptions(
	origin: string,
): SessionRecordingOptions {
	return {
		maskAllInputs: true,
		maskInputOptions: { password: true },
		maskTextSelector: '*',
		blockSelector: [...UNRECORDED_SCREENS, 'input[type="hidden"]'].join(', '),
		maskCapturedNetworkRequestFn: (request) => ({
			...request,
			name: stripUrl(request.name, origin),
		}),
	}
}
