/**
 * Published by `AuthService.signIn` / `signUp` just before the redirect to
 * hosted login, so the fan app can report every start of sign-up or sign-in
 * with where it started (OpenSpec `stories/sign-up-or-sign-in`). `shared/`
 * cannot reach the fan app's analytics, so the fan app's AnalyticsService
 * subscribes; the admin app has no subscriber.
 */
export class AuthStarted {
	constructor(
		public readonly kind: 'sign_up' | 'sign_in',
		/** The screen or control the start came from, as the caller names it. */
		public readonly source: string | undefined,
	) {}
}
