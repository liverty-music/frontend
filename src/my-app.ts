import { IRouter, route } from '@aurelia/router'
import { resolve } from 'aurelia'

@route({
	routes: [
		{
			path: ['', 'welcome'],
			component: import('./welcome-page'),
			title: 'Liverty Music',
			data: { auth: false },
		},
		{
			path: 'about',
			component: import('./about-page'),
			title: 'About',
			data: { auth: false },
		},
		{
			path: 'auth/callback',
			component: import('./routes/auth-callback'),
			title: 'Auth Callback',
			data: { auth: false },
		},
		{
			path: 'onboarding/discover',
			component: import('./routes/artist-discovery/artist-discovery-page'),
			title: 'Discover Artists',
		},
		{
			path: 'onboarding/loading',
			component: import('./routes/onboarding-loading/loading-sequence'),
			title: 'Loading',
		},
		{
			path: 'dashboard',
			component: import('./routes/dashboard'),
			title: 'Dashboard',
		},
		{
			path: 'concerts/:id',
			component: import('./routes/dashboard'),
			title: 'Concert',
		},
		{
			path: 'discover',
			component: import('./routes/discover/discover-page'),
			title: 'Discover',
		},
		{
			path: 'my-artists',
			component: import('./routes/my-artists/my-artists-page'),
			title: 'My Artists',
		},
		{
			path: 'settings',
			component: import('./routes/settings/settings-page'),
			title: 'Settings',
		},
	],
})
export class MyApp {
	private readonly router = resolve(IRouter)

	private readonly fullscreenRoutes = [
		'',
		'welcome',
		'onboarding/discover',
		'onboarding/loading',
		'auth/callback',
	]

	public get currentPath(): string {
		const tree = (this.router as IRouter & { routeTree?: { root?: { children?: Array<{ computeAbsolutePath?: () => string }> } } }).routeTree
		return tree?.root?.children?.[0]?.computeAbsolutePath?.() ?? ''
	}

	public get showNav(): boolean {
		const path = this.currentPath
		return !this.fullscreenRoutes.some((r) => path === r)
	}
}
