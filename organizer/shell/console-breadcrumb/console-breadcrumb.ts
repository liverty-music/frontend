import { resolve } from 'aurelia'
import { IBreadcrumbs } from '../breadcrumbs'

/**
 * The trail of the current screen: 公演 › XX Tour 2026 › 11月3日(火), each
 * part but the last a link. On a compact window it collapses to one link back
 * to the parent (‹ XX Tour 2026).
 */
export class ConsoleBreadcrumb {
	public readonly breadcrumbs = resolve(IBreadcrumbs)
}
