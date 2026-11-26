import { bindable } from 'aurelia'
import type { Crumb } from '../breadcrumbs'

/**
 * The text of one breadcrumb part: a catalog key, a calendar day at the Venue or a name
 * as entered, so the breadcrumb, the back arrow and the top bar's title
 * follow a language switch.
 */
export class CrumbText {
	@bindable public crumb: Crumb | undefined
}
