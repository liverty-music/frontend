import { bindable, INode, resolve } from 'aurelia'

export class SvgIcon {
	@bindable public name = ''
	@bindable public size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' = 'md'

	private readonly element = resolve(INode) as HTMLElement

	public bound(): void {
		this.element.dataset.size = this.size
	}

	public sizeChanged(newVal: string): void {
		this.element.dataset.size = newVal
	}
}
