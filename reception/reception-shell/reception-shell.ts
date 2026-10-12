import { route } from '@aurelia/router'

/**
 * Root component of the reception app. Mounts in `reception.html` as
 * `<reception-shell>` and routes its root to the scanner screen.
 *
 * A Scanner's link is `https://reception.<domain>/#<link token>`: the path is
 * the root and the link token is in the URL fragment, never in the path, so it
 * is never sent to a server. The app has no sign-in and no other route.
 */
@route({
	title: 'Liverty Music',
	routes: [
		{
			path: '',
			component: import('../scanner-route/scanner-route'),
			title: '受付',
		},
	],
})
export class ReceptionShell {}
