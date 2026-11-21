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
			this.element.setAttribute('data-guide-active', this.shape)
			this.guide.setTarget(this.value, this.element)
		} else {
			this.element.removeAttribute('data-guide-active')
		}
	}
}
