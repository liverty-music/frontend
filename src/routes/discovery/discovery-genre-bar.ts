import { I18N } from '@aurelia/i18n'
import { bindable, INode, resolve } from 'aurelia'
import type { GenreFilterController } from './genre-filter-controller'

/**
 * Discovery's genre row: a pinned chip that resets the bubbles, then the
 * genre chips, scrolling sideways. It tells the route with a `bubbles-reset`
 * event or a `genre-select` event carrying the tag.
 */
export class DiscoveryGenreBar {
	public readonly i18n = resolve(I18N)
	private readonly host = resolve(INode) as HTMLElement

	/** The route's genre state: the tags, the active one, and loading. */
	@bindable public genre?: GenreFilterController

	public reset(): void {
		this.host.dispatchEvent(new CustomEvent('bubbles-reset', { bubbles: true }))
	}

	public select(tag: string): void {
		this.host.dispatchEvent(
			new CustomEvent('genre-select', { bubbles: true, detail: tag }),
		)
	}
}
