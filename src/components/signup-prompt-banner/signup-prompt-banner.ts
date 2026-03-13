import { INode, bindable, resolve } from 'aurelia'

export class SignupPromptBanner {
	@bindable public message = '\u{1F514} 通知を有効にするには'
	@bindable public visible = false

	private readonly element = resolve(INode) as HTMLElement

	public onSignup(): void {
		this.element.dispatchEvent(
			new CustomEvent('signup-requested', { bubbles: true }),
		)
	}
}
