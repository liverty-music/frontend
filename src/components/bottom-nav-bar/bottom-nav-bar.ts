import { resolve } from 'aurelia'
import { IPageHeaderState } from '../../services/page-header-state'

interface NavTab {
	path: string
	labelKey: string
	icon: string
}

const tabs: NavTab[] = [
	{ path: 'dashboard', labelKey: 'nav.home', icon: 'home' },
	{ path: 'discovery', labelKey: 'nav.discovery', icon: 'discovery' },
	{ path: 'my-artists', labelKey: 'nav.myArtists', icon: 'my-artists' },
	// Uses the existing 'ticket' icon (svg-icon.html case="ticket").
	{ path: 'tickets', labelKey: 'nav.tickets', icon: 'ticket' },
	{ path: 'settings', labelKey: 'nav.settings', icon: 'settings' },
]

export class BottomNavBar {
	public readonly tabs = tabs

	// Active-tab highlight is derived from the shared page-identity state's
	// `activePath`, which the shell sets optimistically at navigation intent — so
	// the highlight is instant (it no longer waits on router route-tree
	// processing). Public so the template reads `pageHeader.activePath` directly:
	// the `data-active` binding then observes that observable and re-renders on
	// every change. (Passing it INTO `isActive` is deliberate — Aurelia only
	// tracks property reads that appear in the template expression, not ones
	// buried inside a method body, so the read must be in the binding.)
	public readonly pageHeader = resolve(IPageHeaderState)

	/**
	 * Whether `path`'s tab should be highlighted for the given `activePath`. A pure
	 * function of its arguments (keeping the sub-path highlight rules, e.g.
	 * `concerts/:id` highlights Home) — no router, no injected-state read.
	 */
	public isActive(path: string, activePath: string): boolean {
		if (path === 'dashboard') {
			return activePath === 'dashboard' || activePath.startsWith('concerts/')
		}
		return activePath === path || activePath.startsWith(`${path}/`)
	}
}
