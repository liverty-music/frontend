import { IRouterEvents, route } from '@aurelia/router'
import { type IDisposable, resolve, watch } from 'aurelia'
import { chapterOf, guideHref } from '../guide/guide-link'
import { IConsoleLanguage } from '../i18n/console-language'
import { formatJstDay } from '../i18n/format'
import { type Crumb, IBreadcrumbs } from '../shell/breadcrumbs'
import {
	type Destination,
	destinationOf,
} from '../shell/console-navigation/console-navigation'
import { IPageProgress } from '../shell/page-progress'

/** The title of each destination, which shows no breadcrumb. */
const DESTINATION_TITLE: Record<Destination, string> = {
	home: 'home.title',
	concerts: 'concerts.title',
	settings: 'settings.title',
}

/**
 * A console screen's address starts with its Organizer; every other address
 * (sign-in, access denied, another Organizer's, the landing) is unframed.
 */
const FRAMED = /^\/organizers\/[^/]+(\/|$)/

const ARTIST = 'organizers/:organizerId/artists/:artistId/series'

/**
 * Root component of the organizer console entry. Mounts in `organizer.html` as
 * `<organizer-shell>`, owns the route table (design D1) and frames every
 * screen under `/organizers/{id}` with the top bar, the navigation (bar below
 * 600 px, rail from 600 px), the breadcrumb and the snackbar host.
 *
 * Every console address names the caller's Organizer and, below 公演, a
 * represented Artist; `paths` in `model/concert-model.ts` builds them all.
 * `/` and any address the console does not know open the landing, which
 * forwards to the caller's Home.
 *
 * The document title is `<page> — Organizer Console` (design D20): the page
 * is the current breadcrumb part, or the destination's title.
 *
 * `OrganizerAuthHook` and `ConsoleContextHook` (registered globally in
 * `organizer/main.ts`) run on every route: authentication and the owner role,
 * then the address's Organizer. `auth/callback` opts out of both
 * (`auth: false`) so the OIDC code exchange can complete before a session
 * exists, `find-organizer` opts out because a device that knows no
 * Organization cannot sign in, and `denied` opts out of the role check
 * (`role: false`).
 */
@route({
	fallback: 'landing',
	routes: [
		{
			id: 'landing',
			path: '',
			component: import('../landing/landing-route'),
		},
		{
			path: 'organizers/:organizerId',
			component: import('../home/home-route'),
		},
		{
			path: 'organizers/:organizerId/settings',
			component: import('../settings/settings-route'),
		},
		{
			// 公演 before an Artist is chosen: forwards to the Artist worked on,
			// or says that no Artist is represented yet.
			path: 'organizers/:organizerId/artists',
			component: import('../concerts/concerts-route'),
		},
		{
			path: ARTIST,
			component: import('../concerts/concerts-route'),
		},
		{
			path: `${ARTIST}/new`,
			component: import('../concert-editor/concert-editor-route'),
		},
		{
			path: `${ARTIST}/:seriesId`,
			component: import('../concert/concert-route'),
		},
		{
			path: `${ARTIST}/:seriesId/edit`,
			component: import('../concert-editor/concert-editor-route'),
		},
		{
			// The event page; its Sales and Reception tabs and the sale editors
			// (`ticket-sales/new`, `ticket-sales/:saleId/edit`) are its child
			// routes, so a tab is its own address. As sibling routes here, the
			// editors' addresses would match this route plus a residue and never
			// render.
			path: `${ARTIST}/:seriesId/events/:eventId`,
			component: import('../event/event-route'),
		},
		{
			path: 'other-organizer',
			component: import('../denied/denied-route'),
			data: { reason: 'otherOrganizer' },
		},
		{
			path: 'denied',
			component: import('../denied/denied-route'),
			data: { role: false },
		},
		{
			// A device that knows no Organization asks for sign-in links here
			// instead of signing in (design D4); it needs no sign-in.
			path: 'find-organizer',
			component: import('../find-organizer/find-organizer-route'),
			data: { auth: false },
		},
		{
			path: 'auth/callback',
			component: import('../auth-callback/auth-callback-route'),
			data: { auth: false },
		},
	],
})
export class OrganizerShell {
	private readonly events = resolve(IRouterEvents)
	private readonly breadcrumbs = resolve(IBreadcrumbs)
	private readonly language = resolve(IConsoleLanguage)
	public readonly progress = resolve(IPageProgress)
	private readonly subscriptions: IDisposable[] = []
	private finishTransition: (() => void) | null = null

	public framed = false
	public current: Destination = 'home'
	/** 使い方 in the top bar: the guide at the chapter of the screen on show. */
	public helpHref = guideHref('home')

	public binding(): void {
		this.subscriptions.push(
			this.events.subscribe('au:router:navigation-start', () =>
				this.startTransition(),
			),
			this.events.subscribe('au:router:navigation-end', () => {
				const path = window.location.pathname
				this.framed = FRAMED.test(path)
				this.current = destinationOf(path)
				this.helpHref = guideHref(chapterOf(path))
				this.endTransition()
				this.updateTitle()
			}),
			this.events.subscribe('au:router:navigation-cancel', () =>
				this.endTransition(),
			),
			this.events.subscribe('au:router:navigation-error', () =>
				this.endTransition(),
			),
		)
	}

	/**
	 * Sets the document title from the page on show. The text leaves the page
	 * (the tab, the history), so it is taken from the catalog here.
	 */
	@watch((shell: OrganizerShell) => [
		shell.breadcrumbs.trail,
		shell.language.current,
	])
	public updateTitle(): void {
		const product = this.language.text('app.name')
		if (!this.framed) {
			document.title = product
			return
		}
		const crumb = this.breadcrumbs.current
		document.title = this.language.text('app.pageTitle', {
			page: crumb
				? this.crumbText(crumb)
				: this.language.text(DESTINATION_TITLE[this.current]),
		})
	}

	private crumbText(crumb: Crumb): string {
		if (crumb.labelKey) return this.language.text(crumb.labelKey)
		if (crumb.day) return formatJstDay(crumb.day, this.language.current)
		return crumb.label ?? ''
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
