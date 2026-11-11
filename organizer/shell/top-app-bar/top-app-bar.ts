import { bindable, resolve } from 'aurelia'
import { guideHref } from '../../guide/guide-link'
import { IBreadcrumbs } from '../breadcrumbs'
import { IConsoleContext } from '../console-context'

/**
 * The console's top app bar (M3 small top app bar). At its start, on a
 * compact window below a destination, a back arrow to the parent page and the
 * page's title (the breadcrumb's place there); otherwise the brand lockup
 * (`brand-lockup`), which on a medium or wider window sits above the
 * navigation rail. Then the Organizer's name and the Artist being worked on
 * (`organizer-and-artist`) and, at the trailing edge, 使い方 and the account menu
 * (`account-menu`) holding the language switch and サインアウト. 使い方 opens
 * the members' guide at the current screen's chapter in a new tab, so an
 * editor's unsaved input stays (design D4).
 */
export class TopAppBar {
	public readonly context = resolve(IConsoleContext)
	public readonly breadcrumbs = resolve(IBreadcrumbs)

	/** The guide at the current screen's chapter; the shell sets it per page. */
	@bindable public helpHref = guideHref('home')
}
