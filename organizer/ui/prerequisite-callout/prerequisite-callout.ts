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
	 * The heading's level in the page outline: 2 directly under the page title,
	 * 3 inside a section headed by an h2 (Settings).
	 */
	@bindable public level: 2 | 3 = 3
	@bindable public actionLabel = ''
	@bindable public actionHref = ''
}
