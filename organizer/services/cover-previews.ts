import { DI } from 'aurelia'

/** How often, and how long, a screen re-reads for the processed cover (D9a). */
export const COVER_POLL_MS = 3000
export const COVER_POLL_LIMIT_MS = 60_000

/** A cover image set on a Series and not yet served as its processed cover. */
export interface PendingCover {
	readonly seriesId: string
	/** The SeriesImage set as the cover with SetCoverImage. */
	readonly seriesImageId: string
	/** An object URL of the image the member picked, shown until then. */
	readonly previewUrl: string
}

/**
 * The cover images picked in the concert editor while they are processed
 * (design D9a, D19). The editor hands over the picked file and the id of the
 * SeriesImage it set as the cover; the concert page the save returns to (and
 * the editor when reopened) shows that image instead of the previous cover
 * until the Series' cover image id is the uploaded one.
 *
 * In memory only: after a reload the processed image, or the previous cover
 * until it is ready, is shown, as the next open of D9a describes. The store
 * owns each preview's object URL and revokes it once the processed image is
 * served or another image replaces it.
 */
export class CoverPreviews {
	private readonly pending = new Map<string, PendingCover>()

	/** Keeps `file` as the preview of `seriesImageId`, the Series' new cover. */
	public hold(
		seriesId: string,
		seriesImageId: string,
		file: Blob,
	): PendingCover {
		this.forget(seriesId)
		const cover: PendingCover = {
			seriesId,
			seriesImageId,
			previewUrl: URL.createObjectURL(file),
		}
		this.pending.set(seriesId, cover)
		return cover
	}

	/**
	 * The preview still to show for the Series whose served cover image id is
	 * `servedCoverId`; once that is the uploaded image, the preview is
	 * released and undefined is returned.
	 */
	public settle(
		seriesId: string,
		servedCoverId: string | undefined,
	): PendingCover | undefined {
		const cover = this.pending.get(seriesId)
		if (cover && servedCoverId === cover.seriesImageId) {
			this.forget(seriesId)
			return undefined
		}
		return cover
	}

	private forget(seriesId: string): void {
		const cover = this.pending.get(seriesId)
		if (!cover) return
		URL.revokeObjectURL(cover.previewUrl)
		this.pending.delete(seriesId)
	}
}

export const ICoverPreviews = DI.createInterface<ICoverPreviews>(
	'ICoverPreviews',
	(x) => x.singleton(CoverPreviews),
)
export interface ICoverPreviews extends CoverPreviews {}

/** What {@link watchCover} reports back to the screen. */
export interface CoverWatch {
	/**
	 * Reads the Series' served cover image id; the screen updates what it
	 * shows from the same read. Throws when the read fails; the watch then
	 * tries again at the next tick.
	 */
	readonly read: () => Promise<string | undefined>
	/** True once the served cover is the uploaded one; the watch stops. */
	readonly served: (coverId: string | undefined) => boolean
	/** The limit passed without the processed image: say it takes longer. */
	readonly slow: () => void
	readonly now: () => number
}

/**
 * Re-reads every {@link COVER_POLL_MS} for up to {@link COVER_POLL_LIMIT_MS}
 * until the processed cover is served (D9a). Returns the function that stops
 * it, for the screen's `detaching`.
 */
export function watchCover(watch: CoverWatch): () => void {
	const startedAt = watch.now()
	let timer: ReturnType<typeof setTimeout> | null = null
	let stopped = false
	const tick = async (): Promise<void> => {
		timer = null
		try {
			const coverId = await watch.read()
			if (stopped || watch.served(coverId)) return
		} catch {
			// A failed read is retried at the next tick.
		}
		if (stopped) return
		if (watch.now() - startedAt >= COVER_POLL_LIMIT_MS) {
			watch.slow()
			return
		}
		timer = setTimeout(tick, COVER_POLL_MS)
	}
	timer = setTimeout(tick, COVER_POLL_MS)
	return () => {
		stopped = true
		if (timer !== null) clearTimeout(timer)
		timer = null
	}
}
