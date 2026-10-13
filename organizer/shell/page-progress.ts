import { DI } from 'aurelia'

/**
 * Whether the page on show is loading, for the one linear progress indicator
 * the shell shows at the top of the page area (design D18), instead of a
 * spinner per screen. A screen hands its reads to {@link track}; the
 * indicator shows while any of them runs.
 */
export class PageProgress {
	public pending = 0

	public get busy(): boolean {
		return this.pending > 0
	}

	/** Shows the indicator until `work` settles, and returns its result. */
	public async track<T>(work: Promise<T>): Promise<T> {
		this.pending++
		try {
			return await work
		} finally {
			this.pending--
		}
	}
}

export const IPageProgress = DI.createInterface<IPageProgress>(
	'IPageProgress',
	(x) => x.singleton(PageProgress),
)
export interface IPageProgress extends PageProgress {}
