import { bindable, INode, observable, resolve } from 'aurelia'
import { artistHue } from '../../adapter/view/artist-color'
import type { DateGroup, TimetableAnchor } from '../../entities/concert'

export class ConcertHighway {
	@bindable public dateGroups: DateGroup[] = []
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

	public get showSkeleton(): boolean {
		return this.loading && this.dateGroups.length === 0
	}

	private readonly element = resolve(INode) as HTMLElement

	/** Beam indices keyed by event ID, for laser beam tracking. */
	@observable public beamIndexMap: Record<string, number> = {}

	/** Triangular laser beams — one per matched card. */
	@observable public laserBeams: {
		anchorIndex: number
		hue: number
		left: string
		right: string
	}[] = []

	private isAttached = false

	public dateGroupsChanged(): void {
		if (this.isAttached) {
			this.buildBeamIndexMap()
		}
	}

	public attached(): void {
		this.isAttached = true
		this.buildBeamIndexMap()
		this.scrollEl?.addEventListener(
			'contentvisibilityautostatechange',
			this.onGroupRenderedChanged,
		)
		// The very first skipped-to-rendered transition is the browser settling on
		// an initial state rather than changing one, so no event is dispatched for
		// it. One pass after the first layout covers the groups that start on
		// screen; the listener above covers every group reached by scrolling.
		this.redeclareFrame = requestAnimationFrame(() => {
			this.redeclareFrame = 0
			for (const group of this.element.querySelectorAll<HTMLElement>(
				'.date-group',
			)) {
				this.redeclareTimelines(group)
			}
		})
	}

	public detaching(): void {
		this.isAttached = false
		this.scrollEl?.removeEventListener(
			'contentvisibilityautostatechange',
			this.onGroupRenderedChanged,
		)
		if (this.redeclareFrame !== 0) {
			cancelAnimationFrame(this.redeclareFrame)
			this.redeclareFrame = 0
		}
	}

	private redeclareFrame = 0

	/**
	 * Re-declare a date group's view timelines the moment the browser starts
	 * rendering it.
	 *
	 * A named view timeline only registers if the name is declared while its
	 * element is being rendered, and a `content-visibility: auto` group starts out
	 * skipped — before the first layout, every group is. The names are written
	 * from the template binding, which runs before that, so on their own not one
	 * of them takes: measured, 0 of 40 timelines were live, and re-declaring the
	 * same names after layout brought back exactly the 18 whose groups were on
	 * screen. The rest stay dark, which is what they should be.
	 *
	 * This costs nothing per frame and reads no geometry — it fires only when a
	 * group crosses in or out of rendering, which is the only moment the
	 * declaration can land.
	 */
	private readonly onGroupRenderedChanged = (event: Event): void => {
		const { target, skipped } = event as Event & {
			skipped?: boolean
		}
		if (skipped !== false || !(target instanceof HTMLElement)) return
		this.redeclareTimelines(target)
	}

	private redeclareTimelines(group: HTMLElement): void {
		for (const card of group.querySelectorAll<HTMLElement>(
			'[data-beam-index]',
		)) {
			const declared = card.style.getPropertyValue('view-timeline')
			if (declared === '') continue
			card.style.removeProperty('view-timeline')
			card.style.setProperty('view-timeline', declared)
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
	 * happen after the content is rendered.
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
		const group = [...el.querySelectorAll<HTMLElement>('[data-date-key]')].find(
			(node) => node.dataset.dateKey === anchor.dateKey,
		)
		// The group can legitimately be gone — a background refresh may have
		// dropped a date that has since passed. Staying put beats guessing.
		if (!group) return

		// `scrollIntoView` rather than arithmetic on `scrollTop`. Computing the
		// delta ourselves cannot converge: every correction renders more groups,
		// which changes the intrinsic-size estimates the next correction reads, so
		// it oscillates. Measured against a 225-group list, a hand-rolled
		// correction loop still landed 1-3 groups out at every depth, while this
		// landed exactly on the anchor at every depth.
		group.scrollIntoView({ block: 'start', inline: 'nearest' })
		el.scrollTop += anchor.offset
	}

	private get scrollEl(): HTMLElement | null {
		return this.element.querySelector<HTMLElement>('.concert-scroll')
	}

	/** Assign sequential beam indices to matched events across all groups. */
	private buildBeamIndexMap(): void {
		const map: Record<string, number> = {}
		const beams: typeof this.laserBeams = []
		let idx = 0

		const LANE_PCT = [
			{ left: 1, right: 32 },
			{ left: 34.5, right: 65.5 },
			{ left: 68, right: 99 },
		]

		for (const group of this.dateGroups) {
			const lanes = [group.home, group.nearby, group.away]
			for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
				for (const ev of lanes[laneIdx]) {
					if (ev.matched) {
						map[ev.id] = idx
						const { left, right } = LANE_PCT[laneIdx]
						beams.push({
							anchorIndex: idx,
							hue: artistHue(ev.artistName),
							left: `${left}%`,
							right: `${right}%`,
						})
						idx++
					}
				}
			}
		}

		this.beamIndexMap = map
		this.laserBeams = beams

		// Each beam is animated by a view timeline declared on its anchor card, but
		// the beams live in a viewport-fixed overlay that is a SIBLING of the scroll
		// container, not a descendant of any card. A named timeline only resolves
		// across that boundary if a common ancestor puts the name in scope, so the
		// host element carries `timeline-scope` for the whole current beam set.
		// Written once per beam-set change — never per frame.
		this.element.style.setProperty(
			'timeline-scope',
			beams.length > 0
				? beams.map((b) => beamTimelineName(b.anchorIndex)).join(', ')
				: 'none',
		)
	}
}

/**
 * Timeline name for a beam anchor. The set of beams is data-driven, so the names
 * are generated rather than declared in the stylesheet.
 */
export function beamTimelineName(anchorIndex: number): string {
	return `--beam-${anchorIndex}`
}
