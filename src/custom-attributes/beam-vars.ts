import { bindable, customAttribute, INode, resolve } from 'aurelia'
import { beamTimelineName } from '../components/live-highway/concert-highway'

/**
 * Bridges JS→CSS for laser beam presentation.
 *
 * Sets --beam-hue, --beam-left, --beam-right, and the `animation-timeline` that
 * binds this beam to its anchor concert's view timeline. The timeline name is
 * data-driven (one per matched concert), so it cannot be written in the
 * stylesheet — and templates do not carry `style`, which is what this attribute
 * exists for.
 *
 * Usage: <div beam-vars="hue.bind: b.hue; left.bind: b.left; right.bind: b.right; anchor.bind: b.anchorIndex">
 */
@customAttribute('beam-vars')
export class BeamVarsCustomAttribute {
	@bindable() public hue = ''
	@bindable() public left = ''
	@bindable() public right = ''
	/** Beam anchor index; selects the view timeline this beam follows. */
	@bindable() public anchor: number | null = null

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.apply()
	}

	public hueChanged(): void {
		this.apply()
	}

	public leftChanged(): void {
		this.apply()
	}

	public rightChanged(): void {
		this.apply()
	}

	public anchorChanged(): void {
		this.apply()
	}

	public detaching(): void {
		this.element.style.removeProperty('--beam-hue')
		this.element.style.removeProperty('--beam-left')
		this.element.style.removeProperty('--beam-right')
		this.element.style.removeProperty('animation-timeline')
	}

	private apply(): void {
		const el = this.element
		el.style.setProperty('--beam-hue', this.hue || '180')
		el.style.setProperty('--beam-left', this.left || '34%')
		el.style.setProperty('--beam-right', this.right || '66%')
		// Without a timeline the beam stays collapsed, which is the intended
		// degradation where scroll-driven animations are unavailable.
		if (this.anchor === null) {
			el.style.removeProperty('animation-timeline')
		} else {
			el.style.setProperty('animation-timeline', beamTimelineName(this.anchor))
		}
	}
}
