import type { INavigationRoute } from '@aurelia/router'
import { bindable } from 'aurelia'

/**
 * One tab of the bottom navigation bar: a link to a shell route with its
 * icon above its label. The bar decides which tab is selected and handles
 * the tap (it listens on this element in the capture phase).
 */
export class BottomNavTab {
	@bindable public tab!: INavigationRoute
	@bindable public active = false
}
