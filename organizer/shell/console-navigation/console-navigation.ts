import { bindable, resolve } from 'aurelia'
import type { ConsoleIconName } from '../../ui/console-icon/console-icon'
import { IConsoleContext } from '../console-context'

export type Destination = 'home' | 'concerts' | 'settings'

interface DestinationItem {
	id: Destination
	icon: ConsoleIconName
	labelKey: string
}

export const DESTINATIONS: readonly DestinationItem[] = [
	{ id: 'home', icon: 'home', labelKey: 'shell.nav.home' },
	{ id: 'concerts', icon: 'event', labelKey: 'shell.nav.concerts' },
	{ id: 'settings', icon: 'settings', labelKey: 'shell.nav.settings' },
]

/**
 * The destination a console path belongs to: `/organizers/{o}/artists/...` is
 * 公演, `/organizers/{o}/settings` is 設定, anything else Home.
 */
export function destinationOf(path: string): Destination {
	const [collection, , section] = path.replace(/^\/+/, '').split(/[/?#]/)
	if (collection !== 'organizers') return 'home'
	if (section === 'artists') return 'concerts'
	if (section === 'settings') return 'settings'
	return 'home'
}

/**
 * The three destinations: an M3 navigation bar at the bottom of a compact
 * window, a navigation rail on the left from 600 px. One element, laid out by
 * the shell's container query, so crossing 600 px swaps it without a reload.
 * The links name the caller's Organizer; 公演 opens the Artist worked on.
 */
export class ConsoleNavigation {
	@bindable public current: Destination = 'home'
	private readonly context = resolve(IConsoleContext)

	/** The destinations with their links, which follow the address. */
	public get destinations(): Array<DestinationItem & { href: string }> {
		const href: Record<Destination, string> = {
			home: this.context.homeHref,
			concerts: this.context.concertsHref,
			settings: this.context.settingsHref,
		}
		return DESTINATIONS.map((item) => ({ ...item, href: href[item.id] }))
	}
}
