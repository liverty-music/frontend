import { IRouterEvents, route } from '@aurelia/router'
import { type IDisposable, resolve } from 'aurelia'
import {
	type Destination,
	destinationOf,
} from '../shell/console-navigation/console-navigation'

/** Screens shown without the navigation frame (they come before a session). */
const UNFRAMED = /^\/?(denied|auth\/callback)(\/|$)/

/**
 * Root component of the organizer console entry. Mounts in `organizer.html` as
 * `<organizer-shell>`, owns the route table (design D1) and frames every screen
 * but sign-in and access denied with the top bar, the navigation (bar below
 * 600 px, rail from 600 px), the breadcrumb and the snackbar host.
 *
 * `OrganizerAuthHook` (registered globally in `organizer/main.ts`) runs as a
 * shared `canLoad` guard for every route: authentication and the owner role.
 * `auth/callback` opts out of both (`auth: false`) so the OIDC code exchange can
 * complete before a session exists, and `denied` opts out of the role check
 * (`role: false`). An address the console does not know opens Home.
 */
@route({
	title: 'Liverty Music Organizer',
	fallback: 'home',
	routes: [
		{ path: '', redirectTo: 'home' },
		{ path: 'home', component: import('../home/home-route'), title: 'Home' },
		{
			path: 'concerts',
			component: import('../concerts/concerts-route'),
			title: 'Concerts',
		},
		{
			path: 'concerts/new',
			component: import('../concert-editor/concert-editor-route'),
			title: 'New concert',
		},
		{
			path: 'concerts/:seriesId',
			component: import('../concert/concert-route'),
			title: 'Concert',
		},
		{
			path: 'concerts/:seriesId/edit',
			component: import('../concert-editor/concert-editor-route'),
			title: 'Edit concert',
		},
		{
			// The event page; its Sales and Reception tabs and the sale editors
			// (`sales/lottery/new`, `sales/lottery/:saleId`, `sales/first-come`)
			// are its child routes, so a tab is its own address. As sibling
			// routes here, the editors' addresses would match this route plus a
			// residue and never render.
			path: 'concerts/:seriesId/events/:eventId',
			component: import('../event/event-route'),
			title: 'Event',
		},
		{
			path: 'settings',
			component: import('../settings/settings-route'),
			title: 'Settings',
		},
		{
			path: 'denied',
			component: import('../denied/denied-route'),
			title: 'Access denied',
			data: { role: false },
		},
		{
			path: 'auth/callback',
			component: import('../auth-callback/auth-callback-route'),
			title: 'Signing In',
			data: { auth: false },
		},
	],
})
export class OrganizerShell {
	private readonly events = resolve(IRouterEvents)
	private readonly subscriptions: IDisposable[] = []
	private finishTransition: (() => void) | null = null

	public framed = false
	public current: Destination = 'home'

	public binding(): void {
		this.subscriptions.push(
			this.events.subscribe('au:router:navigation-start', () =>
				this.startTransition(),
			),
			this.events.subscribe('au:router:navigation-end', () => {
				const path = window.location.pathname
				this.framed = !UNFRAMED.test(path)
				this.current = destinationOf(path)
				this.endTransition()
			}),
			this.events.subscribe('au:router:navigation-cancel', () =>
				this.endTransition(),
			),
			this.events.subscribe('au:router:navigation-error', () =>
				this.endTransition(),
			),
		)
	}

	public unbinding(): void {
		for (const s of this.subscriptions) s.dispose()
		this.subscriptions.length = 0
		this.endTransition()
	}

	/**
	 * Wraps a navigation between framed screens in a same-document View
	 * Transition (shared-axis X, see organizer-shell.css). Skipped on the first
	 * load, without the API, and under reduced motion.
	 */
	private startTransition(): void {
		if (
			!this.framed ||
			this.finishTransition ||
			typeof document.startViewTransition !== 'function' ||
			matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			return
		}
		const done = new Promise<void>((resolve) => {
			this.finishTransition = resolve
		})
		document.startViewTransition(() => done)
	}

	private endTransition(): void {
		const finish = this.finishTransition
		this.finishTransition = null
		finish?.()
	}
}
