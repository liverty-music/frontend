import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { resolve } from 'aurelia'

interface NavTab {
	path: string
	labelKey: string
	icon: string
}

const tabs: NavTab[] = [
	{ path: 'dashboard', labelKey: 'nav.home', icon: 'home' },
	{ path: 'discover', labelKey: 'nav.discover', icon: 'discover' },
	{ path: 'my-artists', labelKey: 'nav.myArtists', icon: 'my-artists' },
	{ path: 'tickets', labelKey: 'nav.tickets', icon: 'ticket' },
	{ path: 'settings', labelKey: 'nav.settings', icon: 'settings' },
]

export class BottomNavBar {
	public readonly tabs = tabs

	private navElement!: HTMLElement
	private readonly router = resolve(IRouter)
	private readonly i18n = resolve(I18N)

	public attached(): void {
		this.navElement.showPopover()
	}

	public trLabel(key: string): string {
		return this.i18n.tr(key)
	}

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
