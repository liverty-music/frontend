import { INode, resolve } from 'aurelia'
import { dispatchSettling } from '../../util/settling-event'

/**
 * Welcome's commit actions: the note that no account is needed, then
 * [Get Started], [Log In] and the "can't sign in" link below it. Shown under
 * the demo timetable, or in the hero when there is no demo. The buttons ask for the
 * action with bubbling `get-started` and `login` events; each stays busy until
 * the promise the handler passes to `waitUntil` settles.
 */
export class WelcomeCta {
	private readonly host = resolve(INode) as HTMLElement

	/** Asks to start onboarding. */
	public getStarted(): Promise<unknown> | undefined {
		return dispatchSettling(this.host, 'get-started')
	}

	/** Asks to sign in. */
	public login(): Promise<unknown> | undefined {
		return dispatchSettling(this.host, 'login')
	}
}
