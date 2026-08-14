import { route } from '@aurelia/router'

/**
 * Root component of the organizer console entry. Mounts in `organizer.html` as
 * `<organizer-shell>` and owns the organizer route table.
 *
 * `OrganizerAuthHook` (registered globally in `organizer/main.ts`) runs as a
 * shared `canLoad` guard for every route. The default `welcome` route is
 * therefore authentication- AND owner-role-gated; `auth/callback` opts out of
 * both via `data: { auth: false }` so the OIDC code exchange can complete
 * before a session exists, and `denied` opts out of the role check via
 * `data: { role: false }` so a signed-in non-owner sees an explanation.
 */
@route({
	title: 'Liverty Organizer',
	routes: [
		{
			path: '',
			redirectTo: 'welcome',
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
