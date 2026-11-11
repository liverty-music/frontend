import { bindable, INode, resolve } from 'aurelia'

/** What the list shows of a performer; the page passes its own objects. */
export interface Performer {
	readonly id: string
	readonly name: string
}

/**
 * The performers of an Event page, each with the button that follows or
 * unfollows the artist. A press dispatches `follow-toggle` with the performer
 * object it was given; the page does the follow.
 */
export class EventPerformers {
	@bindable public performers: readonly Performer[] = []

	/** Ids of the artists the fan follows. */
	@bindable public followedIds: ReadonlySet<string> = new Set()

	/** False until the fan's follows are known; the buttons wait for them. */
	@bindable public followsLoaded = false

	/** The performer whose follow is being saved, or empty. */
	@bindable public updatingId = ''

	private readonly host = resolve(INode) as HTMLElement

	public toggle(performer: Performer): void {
		this.host.dispatchEvent(
			new CustomEvent<Performer>('follow-toggle', {
				detail: performer,
				bubbles: true,
			}),
		)
	}
}
