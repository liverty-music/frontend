import { bindable, INode, resolve } from 'aurelia'

/** sm 16 px, md 20 px, lg 24 px (an icon that stands on its own), xl 40 px. */
export type SvgIconSize = 'sm' | 'md' | 'lg' | 'xl'

export class SvgIcon {
	@bindable public name = ''
	// Unset, the icon is as large as the text around it (1em).
	@bindable public size?: SvgIconSize

	private readonly element = resolve(INode) as HTMLElement

	public bound(): void {
		this.sizeChanged(this.size)
	}

	public sizeChanged(newVal: SvgIconSize | undefined): void {
		if (newVal) {
			this.element.dataset.size = newVal
		} else {
			delete this.element.dataset.size
		}
	}
}
