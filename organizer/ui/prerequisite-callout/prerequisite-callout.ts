import { bindable } from 'aurelia'

/**
 * Explains why an action is not available yet and links to where it is fixed
 * (事業者情報が未登録です → 設定を開く).
 */
let nextId = 0

export class PrerequisiteCallout {
	public readonly headingId = `prerequisite-callout-${nextId++}`

	@bindable public heading = ''
	/**
	 * The heading's level: 3 under a section heading (Settings), 2 directly
	 * under the page's title (an event's tab), so heading levels never skip.
	 */
	@bindable public level: 2 | 3 = 3
	@bindable public actionLabel = ''
	@bindable public actionHref = ''
}
