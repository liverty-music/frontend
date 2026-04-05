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
		this.scheduleBeamUpdate()
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
		const beamEls = this.element.querySelectorAll<HTMLElement>('.laser-beam')
		const vh = window.innerHeight
		for (const beamEl of beamEls) {
			const idx = beamEl.dataset.beamAnchor
			if (idx == null) continue
			const card = this.element.querySelector<HTMLElement>(
				`[data-beam-index="${idx}"]`,
			)
			if (!card) continue
			const rect = card.getBoundingClientRect()
			const visible = rect.bottom > 0 && rect.top < vh
			if (visible) {
				const bottom = Math.max(0, rect.bottom)
				const topPct =
					bottom > 0 ? `${(Math.max(0, rect.top) / bottom) * 100}%` : '80%'
				beamEl.style.setProperty('--beam-h', `${bottom}px`)
				beamEl.style.setProperty('--beam-top-pct', topPct)
			} else {
				beamEl.style.setProperty('--beam-h', '0')
			}
		}
	}
}
