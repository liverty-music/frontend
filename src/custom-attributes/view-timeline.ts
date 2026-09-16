import { bindable, customAttribute, INode, resolve } from 'aurelia'
import { beamTimelineName } from '../components/live-highway/concert-highway'

/**
 * Declares the host element as the scroll subject driving another element's
 * animation, by naming a view timeline on it.
 *
 * The concert cards drive the laser beams, which live in a viewport-fixed
 * overlay and are therefore not their descendants — a named timeline is what
 * carries that link, and the names are per-concert, so they cannot be written in
 * the stylesheet. Templates do not carry `style`; this attribute is the bridge.
 *
 * A null index declares no timeline at all, so unmatched cards cost nothing.
 *
 * Usage: <div beam-timeline.bind="beamIndex">
 */
@customAttribute('beam-timeline')
export class BeamTimelineCustomAttribute {
	/** Beam anchor index, or null when this element drives no beam. */
	@bindable() public value: number | null = null

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.apply()
	}

	public valueChanged(): void {
		this.apply()
	}

	public detaching(): void {
		this.element.style.removeProperty('view-timeline')
	}

	private apply(): void {
		if (this.value === null) {
			this.element.style.removeProperty('view-timeline')
			return
		}
		this.element.style.setProperty(
			'view-timeline',
			`${beamTimelineName(this.value)} block`,
		)
	}
}
