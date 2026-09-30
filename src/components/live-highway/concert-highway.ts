import { bindable, INode, observable, resolve } from 'aurelia'
import type { DateGroup, TimetableAnchor } from '../../entities/concert'
import { beamTimelineName } from './beam-name'

/**
 * Date groups built when the timetable is first shown, and added per growth
 * step. Twelve median-height groups (192px) is about three phone screens.
 */
export const WINDOW_SIZE = 12
/** Dates kept above the anchored one, so the fan lands with context above. */
export const WINDOW_CONTEXT = 2

export class ConcertHighway {
	@bindable public dateGroups: DateGroup[] = []
	/**
	 * Where to open the timetable: the date the fan left it on. The first
	 * window is built around it, and `attached()` positions the view on it, so
	 * the first paint already shows that date. Null opens at the first date.
	 */
	@bindable public initialAnchor: TimetableAnchor | null = null
	@bindable public isReadonly: boolean = false
	@bindable public showBeams: boolean = true
	/**
	 * When true, every card renders its venue/location label including HOME-lane
	 * cards. Set by the All Nearby dashboard view; default false preserves the My
	 * Timetable behavior where HOME cards suppress the label.
	 */
	@bindable public showVenueAlways: boolean = false
	/**
	 * When true, the AWAY stage/lane is omitted entirely and the grid collapses to
	 * two columns (HOME + NEAR). Set by the All Nearby view, which by definition
	 * returns only HOME/NEARBY concerts; default false keeps the three-lane My
	 * Timetable layout.
	 */
	@bindable public hideAway: boolean = false
	/**
	 * Show the loading placeholder. Owned by the caller because only it knows
	 * whether a load has settled — the highway cannot tell "no concerts yet" from
	 * "no concerts at all", and guessing from an empty list is exactly the
	 * inference that flashes an empty state on re-entry.
	 */
	@bindable public loading: boolean = false

	/**
	 * Placeholder rows, sized to roughly fill a phone viewport. Only rendered
	 * while there is nothing real to show; once groups arrive they replace it in
	 * the same structure, so nothing shifts.
	 */
	public readonly skeletonRows = [0, 1, 2, 3]

	/**
	 * Whether the loading placeholder is shown: while loading, with nothing
	 * real built. A field set in the same step that builds the window
	 * (`sliceWindow`), not a getter: the window's groups are inserted the moment
	 * it is sliced, and a getter's `if` re-evaluates in a later task — so a frame
	 * could paint the placeholder and the first groups together, and the groups
	 * then jumped up by the placeholder's height when it went (CLS ≈ 0.5).
	 * Updating both in one step swaps them in the same frame.
	 */
	public showSkeleton = false

	public loadingChanged(): void {
		this.updateSkeleton()
	}

	private updateSkeleton(): void {
		this.showSkeleton = this.loading && this.visibleGroups.length === 0
	}

	private readonly element = resolve(INode) as HTMLElement

	/**
	 * The date groups actually built: a window `[start, end)` of `dateGroups`
	 * around where the fan is. Dates outside it are not built at all, so what
	 * a render costs is bounded by the window, not by how many dates are
	 * loaded. The window only grows while the fan stays on the page.
	 */
	public visibleGroups: DateGroup[] = []
	private windowStart = 0
	private windowEnd = 0

	/** Empty markers at either end of the window; seeing one grows that side. */
	public topEdge?: HTMLElement
	public bottomEdge?: HTMLElement
	private edgeObserver: IntersectionObserver | null = null

	/**
	 * Triangular laser beams — one per matched card, and none at all while the
	 * effect is off. `timeline` is the view-timeline name the anchor card
	 * carries (see `beamTimelineName`).
	 */
	@observable public laserBeams: {
		timeline: string
		hue: number
		left: string
		right: string
	}[] = []

	private isAttached = false

	public binding(): void {
		this.openWindow(this.initialAnchor?.dateKey ?? null)
	}

	public dateGroupsChanged(): void {
		if (this.isAttached && this.visibleGroups.length > 0) {
			this.keepingPlace(() => this.keepWindow())
		} else {
			this.openWindow(this.initialAnchor?.dateKey ?? null)
		}
		if (this.isAttached) {
			this.buildBeams()
			this.reobserveEdges()
		}
	}

	public showBeamsChanged(): void {
		if (this.isAttached) {
			this.buildBeams()
		}
	}

	public attached(): void {
		this.isAttached = true
		this.buildBeams()
		// The window's groups are already in the DOM here — a component's
		// repeated content is activated before its `attached()` — so the view
		// can be positioned before the first paint, with nothing forced.
		if (this.initialAnchor !== null && this.visibleGroups.length > 0) {
			this.scrollAnchor = this.initialAnchor
		}
		this.observeEdges()
	}

	public detaching(): void {
		this.isAttached = false
		this.edgeObserver?.disconnect()
		this.edgeObserver = null
	}

	/** First window: from a little above the given date, or from the top. */
	private openWindow(dateKey: string | null): void {
		const at = dateKey === null ? 0 : this.indexAtOrAfter(dateKey)
		this.windowStart = Math.max(0, at - WINDOW_CONTEXT)
		this.windowEnd = this.windowStart + WINDOW_SIZE
		this.sliceWindow()
	}

	/**
	 * `dateGroups` was replaced (a filter or a background refresh) while the
	 * fan is on the page. Keep the same span of dates built, so what they are
	 * looking at stays built and in place; only dates that have left the list
	 * leave the window.
	 */
	private keepWindow(): void {
		const first = this.visibleGroups[0].dateKey
		const last = this.visibleGroups[this.visibleGroups.length - 1].dateKey
		const start = this.dateGroups.findIndex((g) => g.dateKey >= first)
		if (start === -1) {
			// Every built date, and everything after it, has left the list (a
			// filter kept only earlier dates): there is no span to keep, so show
			// a full window ending at the last date that remains.
			this.windowStart = Math.max(0, this.dateGroups.length - WINDOW_SIZE)
			this.windowEnd = this.dateGroups.length
			this.sliceWindow()
			return
		}
		const end = this.dateGroups.findIndex((g) => g.dateKey > last)
		this.windowStart = start
		this.windowEnd = Math.max(
			start + WINDOW_SIZE,
			end === -1 ? this.dateGroups.length : end,
		)
		this.sliceWindow()
	}

	private sliceWindow(): void {
		const total = this.dateGroups.length
		this.windowStart = Math.min(this.windowStart, Math.max(0, total - 1))
		this.windowEnd = Math.min(total, this.windowEnd)
		this.visibleGroups = this.dateGroups.slice(this.windowStart, this.windowEnd)
		this.updateSkeleton()
	}

	/**
	 * Index of the given date, or of the nearest later one when it has left the
	 * list (date keys are ISO dates, so they sort as strings). Past the end, the
	 * last date.
	 */
	private indexAtOrAfter(dateKey: string): number {
		const i = this.dateGroups.findIndex((g) => g.dateKey >= dateKey)
		return i === -1 ? Math.max(0, this.dateGroups.length - 1) : i
	}

	/**
	 * Change the built window without moving what the fan is looking at: note
	 * the date at the top edge and how far into it they are, apply the change,
	 * and put that date back where it was.
	 *
	 * The window's DOM is complete as soon as it is sliced, so this needs no
	 * flush or scheduling. Reading the position after the change lays out the
	 * new groups a little earlier than the next frame would have — the same
	 * work, not additional work. Done here rather than left to the browser's
	 * scroll anchoring, which measured unreliable on this list (a fixed partial
	 * correction on about 40% of prepends in Chromium) and which Safari does
	 * not implement; the scroll container therefore opts out of it
	 * (`overflow-anchor: none`), so the two never both correct.
	 */
	private keepingPlace(change: () => void): void {
		const place = this.scrollAnchor
		change()
		if (place !== null) this.scrollAnchor = place
	}

	/**
	 * Grow the window before the fan reaches either edge. One observer, rooted
	 * at the scroll container, watches both edge markers half a screen ahead.
	 * Dates added above the fan keep what they are looking at in place (see
	 * `keepingPlace`); dates added below cannot move it.
	 */
	private observeEdges(): void {
		if (typeof IntersectionObserver === 'undefined') return
		const root = this.scrollEl
		if (!root) return
		this.edgeObserver = new IntersectionObserver(
			(entries) => this.onEdgesSeen(entries),
			{ root, rootMargin: '50% 0px' },
		)
		if (this.topEdge) this.edgeObserver.observe(this.topEdge)
		if (this.bottomEdge) this.edgeObserver.observe(this.bottomEdge)
	}

	/**
	 * Have the observer report both edges once more. An edge that was already in
	 * reach before the window changed is still in reach after it, and an
	 * observer reports only changes, so without this a replaced list that
	 * gained dates beyond an edge in reach would never grow toward them.
	 */
	private reobserveEdges(): void {
		const observer = this.edgeObserver
		if (!observer) return
		for (const edge of [this.topEdge, this.bottomEdge]) {
			if (!edge) continue
			observer.unobserve(edge)
			observer.observe(edge)
		}
	}

	private onEdgesSeen(entries: IntersectionObserverEntry[]): void {
		let above = false
		let below = false
		for (const entry of entries) {
			if (!entry.isIntersecting) continue
			if (entry.target === this.topEdge && this.windowStart > 0) {
				this.windowStart = Math.max(0, this.windowStart - WINDOW_SIZE)
				above = true
			} else if (
				entry.target === this.bottomEdge &&
				this.windowEnd < this.dateGroups.length
			) {
				this.windowEnd += WINDOW_SIZE
				below = true
			}
		}
		if (!above && !below) return
		if (above) {
			this.keepingPlace(() => this.sliceWindow())
		} else {
			this.sliceWindow()
		}
		this.buildBeams()
		// An observer reports only changes, so an edge that is still in reach
		// after growing — short groups, a tall screen — would never report
		// again. Observing it afresh reports its state once more, after layout.
		for (const entry of entries) {
			this.edgeObserver?.unobserve(entry.target)
			this.edgeObserver?.observe(entry.target)
		}
	}

	/**
	 * Where the fan is in the timetable, as the date group at the top edge plus
	 * how far into it they have scrolled. Exposed as component API because this
	 * component owns the scroll container — the dashboard needs to save and
	 * restore the fan's place across navigation, and reaching into another
	 * component's DOM to do it would couple the route to this markup.
	 *
	 * Deliberately not a pixel offset: see `TimetableAnchor`. Reading before the
	 * view is in the DOM yields null; writing then is a no-op, so a restore has to
	 * happen once the window is rendered — `attached()` does it for
	 * `initialAnchor`.
	 */
	public get scrollAnchor(): TimetableAnchor | null {
		const el = this.scrollEl
		if (!el) return null

		const edge = el.getBoundingClientRect().top
		for (const group of el.querySelectorAll<HTMLElement>('[data-date-key]')) {
			const box = group.getBoundingClientRect()
			// The first group still crossing the top edge is the one the fan is
			// looking at; anything above it has been scrolled past.
			if (box.bottom > edge + 0.5) {
				const dateKey = group.dataset.dateKey
				if (dateKey === undefined) return null
				return { dateKey, offset: Math.max(0, edge - box.top) }
			}
		}
		return null
	}

	public set scrollAnchor(anchor: TimetableAnchor | null) {
		const el = this.scrollEl
		if (!el || anchor === null) return

		// Matched by value rather than built into a selector: a date key is data,
		// and interpolating data into a selector is a habit worth not having.
		// The date can legitimately be gone — a background refresh may have
		// dropped one that has since passed — so land on the nearest later date
		// that remains (groups are in date order), without the offset, which
		// belonged to the date that is gone.
		const group = [...el.querySelectorAll<HTMLElement>('[data-date-key]')].find(
			(node) => (node.dataset.dateKey ?? '') >= anchor.dateKey,
		)
		if (!group) return

		// `scrollIntoView` rather than arithmetic on `scrollTop`: the browser
		// resolves where the group is, and only built groups are laid out.
		group.scrollIntoView({ block: 'start', inline: 'nearest' })
		if (group.dataset.dateKey === anchor.dateKey) {
			el.scrollTop += anchor.offset
		}
	}

	private get scrollEl(): HTMLElement | null {
		return this.element.querySelector<HTMLElement>('.concert-scroll')
	}

	/**
	 * Build the beam set: one beam per matched concert, named after it. Only
	 * while the effect is on — off, nothing is computed and the set is empty.
	 *
	 * The cards need nothing from this: each already carries its timeline name,
	 * and the stylesheet declares the timeline only under the beams-on marker.
	 * So turning beams on or off rebuilds no card.
	 */
	private buildBeams(): void {
		if (!this.showBeams) {
			this.laserBeams = []
			this.element.style.setProperty('timeline-scope', 'none')
			return
		}

		const beams: typeof this.laserBeams = []

		const LANE_PCT = [
			{ left: 1, right: 32 },
			{ left: 34.5, right: 65.5 },
			{ left: 68, right: 99 },
		]

		// Only built dates: a concert whose date is not built has no card, so it
		// has no beam either.
		for (const group of this.visibleGroups) {
			const lanes = [group.home, group.nearby, group.away]
			for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
				for (const ev of lanes[laneIdx]) {
					if (ev.matched) {
						const { left, right } = LANE_PCT[laneIdx]
						beams.push({
							timeline: beamTimelineName(ev.id),
							hue: ev.artistHue,
							left: `${left}%`,
							right: `${right}%`,
						})
					}
				}
			}
		}

		this.laserBeams = beams

		// Each beam is animated by a view timeline declared on its anchor card, but
		// the beams live in a viewport-fixed overlay that is a SIBLING of the scroll
		// container, not a descendant of any card. A named timeline only resolves
		// across that boundary if a common ancestor puts the name in scope, so the
		// host element carries `timeline-scope` for the whole current beam set.
		// Written once per beam-set change — never per frame.
		this.element.style.setProperty(
			'timeline-scope',
			beams.length > 0 ? beams.map((b) => b.timeline).join(', ') : 'none',
		)
	}
}
