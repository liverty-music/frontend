import { bindable, customAttribute, INode, resolve, watch } from 'aurelia'
import { type GuideMoment, IGuideService } from '../services/guide-service'

/**
 * Marks the control a guide moment points at: `guide-target="discovery.swap"`,
 * or `guide-target="value: discovery.follow; shape: inset"` for a target that
 * fills the screen and glows along its inner edge instead of a ring.
 * While that moment is current the element carries `data-guide-active` (its
 * value is the shape), which
 * the shared glow (`utilities.css`) and the target's own block styles draw and
 * which names the anchor the guide line sits next to. The attribute registers
 * the element with {@link IGuideService} so a tap on it is not taken as a tap
 * elsewhere; the target's own handler reports the use.
 *
 * When the moment ends the glow goes at once, but the element keeps
 * `data-guide-anchor`, so the fading guide line stays beside it; the next
 * target to light up takes the anchor away.
 */
@customAttribute('guide-target')
export class GuideTargetCustomAttribute {
	@bindable public value: GuideMoment | '' = ''
	/**
	 * `ring` (a button), `inset` (a target that fills the screen: a glow along
	 * its inner edge), `bell` (a ring that also swings like a bell) or `dots`
	 * (no ring: the target's block lights its own parts, the hype dots).
	 */
	@bindable public shape: 'ring' | 'inset' | 'bell' | 'dots' = 'ring'

	private readonly element = resolve(INode) as HTMLElement
	private readonly guide = resolve(IGuideService)

	public attached(): void {
		this.sync(this.isActive)
	}

	public detaching(): void {
		this.element.removeAttribute('data-guide-active')
		this.element.removeAttribute('data-guide-anchor')
	}

	public get isActive(): boolean {
		return this.value !== '' && this.guide.current === this.value
	}

	@watch((vm: GuideTargetCustomAttribute) => vm.isActive)
	public activeChanged(active: boolean): void {
		this.sync(active)
	}

	private sync(active: boolean): void {
		if (active && this.value !== '') {
			// One anchor at a time: of two, the later in the document would win.
			for (const old of document.querySelectorAll('[data-guide-anchor]')) {
				old.removeAttribute('data-guide-anchor')
			}
			this.element.setAttribute('data-guide-anchor', '')
			this.element.setAttribute('data-guide-active', this.shape)
			this.guide.setTarget(this.value, this.element)
		} else {
			this.element.removeAttribute('data-guide-active')
		}
	}
}
