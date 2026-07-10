import { bindable, INode, observable, resolve } from 'aurelia'
import { artistHue } from '../../adapter/view/artist-color'
import type { DateGroup } from '../../entities/concert'

export class ConcertHighway {
	@bindable public dateGroups: DateGroup[] = []
	@bindable public isReadonly: boolean = false
	@bindable public showBeams: boolean = true

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

	private beamRafId = 0
	private isAttached = false
	private scrollContainer: Element | null = null
	private readonly onScroll = (): void => this.scheduleBeamUpdate()

	/**
	 * Cached anchor→card element map, keyed by beam-anchor index. Rebuilt only
	 * when the beam set changes, so the per-frame update resolves each beam's
	 * card from this map instead of a per-frame `querySelector`.
	 */
	private readonly beamElements = new Map<number, HTMLElement>()
	private beamElementsDirty = false

	public dateGroupsChanged(): void {
		if (this.isAttached) {
			this.buildBeamIndexMap()
		}
	}

	public attached(): void {
		this.isAttached = true
		this.setupBeamTracking()
		this.buildBeamIndexMap()
	}

	public detaching(): void {
		this.isAttached = false
		if (this.scrollContainer) {
			this.scrollContainer.removeEventListener('scroll', this.onScroll)
			this.scrollContainer = null
		}
		if (this.beamRafId) {
			cancelAnimationFrame(this.beamRafId)
			this.beamRafId = 0
		}
		this.beamElements.clear()
		this.beamElementsDirty = true
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
		// The beam set changed; the cached anchor→element map must be rebuilt.
		// The actual DOM query is deferred to the scheduled rAF, where Aurelia
		// has already flushed the new `data-beam-index` attributes.
		this.beamElementsDirty = true
		this.scheduleBeamUpdate()
	}

	/** Rebuild the anchor→card element map from the current DOM. */
	private rebuildBeamElements(): void {
		this.beamElements.clear()
		const cards =
			this.element.querySelectorAll<HTMLElement>('[data-beam-index]')
		for (const card of cards) {
			const idx = card.dataset.beamIndex
			if (idx == null) continue
			this.beamElements.set(Number(idx), card)
		}
		this.beamElementsDirty = false
	}

	/** Wire scroll listener for JS-based beam height tracking. */
	private setupBeamTracking(): void {
		const scroll = this.element.querySelector('.concert-scroll')
		if (scroll) {
			this.scrollContainer = scroll
			scroll.addEventListener('scroll', this.onScroll, { passive: true })
			this.scheduleBeamUpdate()
		}
	}

	private scheduleBeamUpdate(): void {
		if (this.beamRafId) return
		this.beamRafId = requestAnimationFrame(() => {
			this.beamRafId = 0
			this.updateBeamPositions()
		})
	}

	/** Set beam dimensions so triangle wraps card diagonally (bottom-left to top-right). */
	private updateBeamPositions(): void {
		if (this.beamElementsDirty) {
			this.rebuildBeamElements()
		}
		const beamEls = this.element.querySelectorAll<HTMLElement>('.laser-beam')
		const vh = window.innerHeight

		// Read phase: collect every beam's geometry before mutating any style,
		// so no layout read follows a style write within this frame.
		const writes: { beamEl: HTMLElement; height: string; topPct?: string }[] =
			[]
		for (const beamEl of beamEls) {
			const idx = beamEl.dataset.beamAnchor
			if (idx == null) continue
			const card = this.beamElements.get(Number(idx))
			if (!card) continue
			const rect = card.getBoundingClientRect()
			const visible = rect.bottom > 0 && rect.top < vh
			if (visible) {
				const bottom = Math.max(0, rect.bottom)
				const topPct =
					bottom > 0 ? `${(Math.max(0, rect.top) / bottom) * 100}%` : '80%'
				writes.push({ beamEl, height: `${bottom}px`, topPct })
			} else {
				writes.push({ beamEl, height: '0' })
			}
		}

		// Write phase: apply all style writes after every read has completed.
		for (const { beamEl, height, topPct } of writes) {
			beamEl.style.setProperty('--beam-h', height)
			if (topPct != null) {
				beamEl.style.setProperty('--beam-top-pct', topPct)
			}
		}
	}
}
