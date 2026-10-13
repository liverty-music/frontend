import { IRouterEvents } from '@aurelia/router'
import { DI, resolve } from 'aurelia'

/**
 * One part of a breadcrumb: a parent page (with `href`) or the current page.
 * Its text is a catalog key, a Japan-time day, or a name as entered (a concert
 * title), so a language switch updates the trail too.
 */
export interface Crumb {
	labelKey?: string
	day?: Date
	label?: string
	href?: string
}

/**
 * The breadcrumb of the screen on show. A screen below a destination sets its
 * trail (its parents up to the destination, then itself) once it knows their
 * names; the shell's breadcrumb renders it. A navigation whose screen sets no
 * trail clears the previous one, so a destination screen shows none.
 */
export class Breadcrumbs {
	public trail: Crumb[] = []
	private navigation = 0
	private setIn = -1

	public constructor() {
		const events = resolve(IRouterEvents)
		events.subscribe('au:router:navigation-start', () => {
			this.navigation++
		})
		events.subscribe('au:router:navigation-end', () => {
			if (this.setIn !== this.navigation) this.trail = []
		})
	}

	/** Sets the trail of the screen being shown: parents first, itself last. */
	public set(trail: Crumb[]): void {
		this.trail = trail
		this.setIn = this.navigation
	}

	/** The nearest parent with a link (for the compact breadcrumb). */
	public get parent(): Crumb | undefined {
		return [...this.trail].reverse().find((c) => c.href)
	}
}

export const IBreadcrumbs = DI.createInterface<IBreadcrumbs>(
	'IBreadcrumbs',
	(x) => x.singleton(Breadcrumbs),
)
export interface IBreadcrumbs extends Breadcrumbs {}
