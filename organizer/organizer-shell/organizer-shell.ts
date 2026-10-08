import { route } from '@aurelia/router'

/**
 * Root component of the organizer console entry. Mounts in `organizer.html` as
 * `<organizer-shell>` and owns the organizer route table.
 *
 * `OrganizerAuthHook` (registered globally in `organizer/main.ts`) runs as a
 * shared `canLoad` guard for every route. The default landing (`concerts`),
 * the authoring routes, and the lottery configure/status routes are therefore
 * authentication- AND owner-role-gated;
 * `auth/callback` opts out of both via `data: { auth: false }` so the OIDC code
 * exchange can complete before a session exists, `reception/:token` opts out
 * because venue staff open it from a reception link without an account, and `denied` opts out of the
 * role check via `data: { role: false }` so a signed-in non-owner sees an
 * explanation. The authoring routes deliberately DO NOT set `auth: false` — the
 * global hook guards them.
 *
 * The post-login landing is the concerts dashboard: an authenticated owner goes
 * straight to their own catalog. `welcome` is kept as a reachable route but is
 * no longer the default.
 */
@route({
	title: 'Liverty Music Organizer',
	routes: [
		{
			path: '',
			redirectTo: 'concerts',
		},
		{
			path: 'concerts',
			component: import('../concerts/concerts-route'),
			title: 'Your concerts',
		},
		{
			path: 'concerts/new',
			component: import('../concert-editor/concert-editor-route'),
			title: 'New concert',
		},
		{
			path: 'concerts/edit/:seriesId',
			component: import('../concert-editor/concert-editor-route'),
			title: 'Edit concert',
		},
		{
			// Configure a lottery phase on a PUBLISHED event (roadmap ④, task 5.1).
			// Reached by the target event id. TODO(entry-point): the concerts
			// dashboard has no per-event "put on sale" affordance yet (its rows are
			// series-scoped and carry no event ids), so this route is currently
			// reachable only by deep link — wire a dashboard/edit-screen link once
			// the console exposes event ids.
			path: 'lottery/configure/:eventId',
			component: import('../lottery-phase-editor/lottery-phase-editor-route'),
			title: 'Configure lottery phase',
		},
		{
			// Lottery phase status / draw-outcome summary (roadmap ④, task 5.2).
			path: 'lottery/status/:phaseId',
			component: import('../lottery-status/lottery-status-route'),
			title: 'Lottery phase status',
		},
		{
			// Reception links of one event (ticket-wallet-and-checkin, task 5.1),
			// reached from the event's row on the concerts dashboard.
			path: 'reception-links/:eventId',
			component: import('../reception-links/reception-links-route'),
			title: 'Reception links',
		},
		{
			// The reception screen venue staff open from a reception link (task
			// 5.2). Staff have no account: the route is exempt from the console
			// sign-in and the owner-role check, and the link token comes from the
			// URL. Every call it makes is signed by the device the link is bound to.
			path: 'reception/:token',
			component: import('../reception/reception-route'),
			title: '受付',
			data: { auth: false },
		},
		{
			path: 'welcome',
			component: import('../welcome/welcome-route'),
			title: 'Welcome',
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
export class OrganizerShell {}
