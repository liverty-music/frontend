import { IRouter, route } from '@aurelia/router'
import { resolve } from 'aurelia'

@route({
	routes: [
		{
			path: ['', 'welcome'],
			component: import('./welcome-page'),
			title: 'Liverty Music',
		},
		{
			path: 'about',
			component: import('./about-page'),
			title: 'About',
		},
		{
			path: 'auth/callback',
			component: import('./routes/auth-callback'),
			title: 'Auth Callback',
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
	],
})
export class MyApp {
	private readonly router = resolve(IRouter)

	private readonly fullscreenRoutes = ['', 'welcome', 'onboarding/discover', 'onboarding/loading', 'auth/callback']

	public get showNav(): boolean {
		const path = this.router.activeNavigation?.path ?? ''
		return !this.fullscreenRoutes.some(r => path === r || path === `/${r}`)
	}
}
