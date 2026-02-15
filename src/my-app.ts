import { route } from '@aurelia/router'

@route({
	routes: [
		{
			path: ['', 'welcome'],
			component: import('./welcome-page'),
			title: 'Welcome',
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
			path: 'artist-discovery',
			component: import('./routes/artist-discovery/artist-discovery-page'),
			title: 'Discover Artists',
		},
		{
			path: 'onboarding/loading',
			component: import('./routes/onboarding-loading/loading-sequence'),
			title: 'Loading',
		},
	],
})
export class MyApp {}
