import { IRouter } from '@aurelia/router'
import { resolve } from 'aurelia'

interface NavTab {
	path: string
	label: string
	icon: string
}

const tabs: NavTab[] = [
	{ path: 'dashboard', label: 'Home', icon: 'home' },
	{ path: 'discover', label: 'Discover', icon: 'discover' },
	{ path: 'my-artists', label: 'My Artists', icon: 'my-artists' },
	{ path: 'tickets', label: 'Tickets', icon: 'ticket' },
	{ path: 'settings', label: 'Settings', icon: 'settings' },
]

export class BottomNavBar {
	public readonly tabs = tabs

	private readonly router = resolve(IRouter)

	private get currentPath(): string {
		const tree = (
			this.router as IRouter & {
				routeTree?: {
					root?: { children?: Array<{ computeAbsolutePath?: () => string }> }
				}
			}
		).routeTree
		return tree?.root?.children?.[0]?.computeAbsolutePath?.() ?? ''
	}

	public isActive(path: string): boolean {
		const current = this.currentPath
		// Match exact path or sub-paths (e.g. concerts/:id still highlights Home)
		if (path === 'dashboard') {
			return current === 'dashboard' || current.startsWith('concerts/')
		}
		return current === path || current.startsWith(`${path}/`)
	}
}
