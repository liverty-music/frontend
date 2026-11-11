import { bindable } from 'aurelia'

/**
 * Welcome's commit actions: the note that no account is needed, then
 * [Get Started], [Log In] and the "can't sign in" link below it. Shown under
 * the demo timetable, or in the hero when there is no demo. Each button stays
 * busy until its action settles.
 */
export class WelcomeCta {
	/** Starts onboarding. */
	@bindable public onGetStarted?: () => Promise<void>

	/** Signs in. */
	@bindable public onLogin?: () => Promise<void>
}
