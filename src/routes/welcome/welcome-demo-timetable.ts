import { bindable } from 'aurelia'
import type { DateGroup } from '../../entities/concert'

/**
 * The second step of Welcome's demo, one screen: a tagline, the interactive
 * timetable (a card tap opens the real detail sheet through the timetable's
 * `event-selected` event) and the commit actions under it.
 */
export class WelcomeDemoTimetable {
	/** The preview concerts, by date. */
	@bindable public dateGroups: DateGroup[] = []

	/** Starts onboarding. */
	@bindable public onGetStarted?: () => Promise<void>

	/** Signs in. */
	@bindable public onLogin?: () => Promise<void>
}
