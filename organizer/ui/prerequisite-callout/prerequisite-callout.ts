import { bindable, INode, resolve } from 'aurelia'
import { type GuideChapter, guideHref } from '../../guide/guide-link'

let nextId = 0

/**
 * Explains why an action is not available yet and offers its fix
 * (事業者情報が未登録です → 設定を開く): a link with `action-href`, or with
 * only `action-label` a button whose press the screen hears as the callout's
 * `action` event. The fix reads as a link in the callout's own text color:
 * the brand color marks only the page's primary action, focus and the logo
 * (design-tokens). With `guide-chapter`, a secondary 詳しく見る link below the
 * fix opens the members' guide at that chapter in a new tab.
 */

export class PrerequisiteCallout {
	private readonly host = resolve(INode) as HTMLElement
	public readonly headingId = `prerequisite-callout-${nextId++}`

	@bindable public heading = ''
	/**
	 * The heading's level in the page outline: 2 directly under the page title,
	 * 3 inside a section headed by an h2 (Settings).
	 */
	@bindable public level: 2 | 3 = 3
	@bindable public actionLabel = ''
	@bindable public actionHref = ''
	/** The guide's chapter that explains this notice; none shows no link. */
	@bindable public guideChapter: GuideChapter | '' = ''

	public get guideHref(): string {
		return this.guideChapter ? guideHref(this.guideChapter) : ''
	}

	/** The fix was pressed: the screen runs it (`action.trigger`). */
	public act(): void {
		this.host.dispatchEvent(new CustomEvent('action', { bubbles: true }))
	}
}
