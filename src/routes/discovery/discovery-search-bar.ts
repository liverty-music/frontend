import { I18N } from '@aurelia/i18n'
import { bindable, INode, resolve } from 'aurelia'
import type { SearchController } from './search-controller'

/**
 * Discovery's artist search field. The query lives on the route's search
 * controller, which this bar edits; the clear button asks the route to
 * clear it with a `search-clear` event.
 */
export class DiscoverySearchBar {
	public readonly i18n = resolve(I18N)
	private readonly host = resolve(INode) as HTMLElement

	/** The route's search state; the bar binds its query. */
	@bindable public search?: SearchController

	/**
	 * Enter (the keyboard's search key) searches at once. The Enter that
	 * confirms an input method conversion is the input method's: browsers mark
	 * it `isComposing`, and Safari sends it after the composition ends with
	 * key code 229.
	 */
	public onKeydown(event: KeyboardEvent): boolean {
		if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
			this.search?.searchNow()
		}
		return true
	}

	public clear(): void {
		this.host.dispatchEvent(new CustomEvent('search-clear', { bubbles: true }))
	}
}
