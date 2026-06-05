import { route } from '@aurelia/router'

/**
 * Root component of the admin console entry. Mounts in `admin.html` as
 * `<admin-shell>` and owns the admin route table.
 *
 * `AdminAuthHook` (registered globally in `admin/main.ts`) runs as a shared
 * `canLoad` guard for every route. The default `welcome` route is therefore
 * authentication-gated; only `auth/callback` opts out via
 * `data: { auth: false }` so the OIDC code exchange can complete before a
 * session exists.
 */
@route({
	title: 'Liverty Admin',
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
			path: 'auth/callback',
			component: import('../auth-callback/auth-callback-route'),
			title: 'Signing In',
			data: { auth: false },
		},
	],
})
export class AdminShell {}
