import { bindable, INode, resolve } from 'aurelia'

/**
 * Welcome's first screen, the hook: wordmark, headline, the pain and the
 * action it offers, and the language choice. With a demo below it shows one
 * button that asks for the demo with a `see-preview` event; without one it
 * shows the commit actions itself. A language choice bubbles up from the
 * picker as `language-select`.
 */
export class WelcomeHero {
	private readonly host = resolve(INode) as HTMLElement

	/** A demo is shown below the hero. */
	@bindable public hasPreview = false

	/** The languages offered. */
	@bindable public languages: readonly string[] = []

	/** The language in use. */
	@bindable public currentLocale = ''

	/** Starts onboarding. */
	@bindable public onGetStarted?: () => Promise<void>

	/** Signs in. */
	@bindable public onLogin?: () => Promise<void>

	public seePreview(): void {
		this.host.dispatchEvent(new CustomEvent('see-preview', { bubbles: true }))
	}
}
