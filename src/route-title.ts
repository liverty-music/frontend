import type { Transition } from '@aurelia/router'
import type { ShellRouteData } from './app-shell'

/** The product name, the browser tab title of a screen with no title. */
export const APP_TITLE = 'Liverty Music'

/**
 * The browser tab title of the screen a navigation displays: its `nav.*`
 * title, the same key the page header shows, followed by the product name
 * ("Checkout | Liverty Music"). Screen titles are the same English in every
 * language (global/i18n "Screen titles are invariant across locales"), so the
 * tab title does not follow a language switch. A sheet or a Discovery view is
 * state in the query string, not a route, so it does not change the title.
 */
export function documentTitle(
	transition: Transition,
	tr: (key: string) => string,
): string {
	const data = transition.routeTree.root.children[0]?.data as
		| ShellRouteData
		| undefined
	const key = data?.titleKey
	return key ? `${tr(key)} | ${APP_TITLE}` : APP_TITLE
}
