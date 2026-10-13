import { bindable } from 'aurelia'
import type { ConsoleIconName } from '../../ui/console-icon/console-icon'

export type Destination = 'home' | 'concerts' | 'settings'

interface DestinationItem {
	id: Destination
	href: string
	icon: ConsoleIconName
	labelKey: string
}

export const DESTINATIONS: readonly DestinationItem[] = [
	{ id: 'home', href: '/home', icon: 'home', labelKey: 'shell.nav.home' },
	{
		id: 'concerts',
		href: '/concerts',
		icon: 'event',
		labelKey: 'shell.nav.concerts',
	},
	{
		id: 'settings',
		href: '/settings',
		icon: 'settings',
		labelKey: 'shell.nav.settings',
	},
]

/** The destination a console path belongs to. */
export function destinationOf(path: string): Destination {
	const first = path.replace(/^\/+/, '').split(/[/?#]/)[0]
	if (first === 'concerts') return 'concerts'
	if (first === 'settings') return 'settings'
	return 'home'
}

/**
 * The three destinations: an M3 navigation bar at the bottom of a compact
 * window, a navigation rail on the left from 600 px. One element, laid out by
 * the shell's container query, so crossing 600 px swaps it without a reload.
 */
export class ConsoleNavigation {
	@bindable public current: Destination = 'home'
	public readonly destinations = DESTINATIONS
}
