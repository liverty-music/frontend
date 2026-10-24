import type { SessionRecordingOptions } from 'posthog-js'
import { stripUrl } from './strip-own-url-query'

/**
 * Route elements of the screens that are never recorded: the checkout, the
 * lottery entry and its status, the identity check and Settings (with its
 * passkeys screen). Blocking a route element replaces the whole screen with
 * an empty box, so nothing of it is recorded even before recording stops on
 * its address ({@link isUnrecordedPath}).
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

/**
 * Addresses of the screens in {@link UNRECORDED_SCREENS} (`app-shell.ts`
 * routes). AnalyticsService stops recording while one of them is shown, so
 * no recording is made of them at all (OpenSpec `global/analytics`, "Screen
 * that is never recorded"); the session's recording resumes on the next
 * screen.
 */
const UNRECORDED_PATHS: readonly RegExp[] = [
	/^\/events\/[^/]+\/checkout\/?$/,
	/^\/events\/[^/]+\/lottery\//,
	/^\/verify\//,
	/^\/settings(\/|$)/,
]

export function isUnrecordedPath(pathname: string): boolean {
	return UNRECORDED_PATHS.some((path) => path.test(pathname))
}
