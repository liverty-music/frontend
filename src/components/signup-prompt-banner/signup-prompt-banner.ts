import { bindable, INode, resolve } from 'aurelia'

/**
 * The guest's signup prompt. While it shows, global.css publishes its fixed
 * height (--bottom-banner-height) for the route area and the snack bar.
 */
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
