import { resolve } from 'aurelia'
import { IBreadcrumbs } from '../breadcrumbs'

/**
 * The trail of the current screen on a medium or wider window:
 * 公演 › XX Tour 2026 › 11月3日(火), each part but the last a link. A compact
 * window shows none; the top bar's back arrow leads to the parent there.
 */
export class ConsoleBreadcrumb {
	public readonly breadcrumbs = resolve(IBreadcrumbs)
}
