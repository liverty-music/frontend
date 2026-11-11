import { bindable, INode, resolve } from 'aurelia'

/**
 * The language choice on Welcome: one radio per language, drawn as its name,
 * the chosen one underlined. A choice is told with a `language-select` event
 * carrying the language; the caller changes the locale and `current` follows.
 */
export class WelcomeLanguagePicker {
	private readonly host = resolve(INode) as HTMLElement

	/** The languages offered. */
	@bindable public languages: readonly string[] = []

	/** The language in use. */
	@bindable public current = ''

	public select(lang: string): void {
		this.host.dispatchEvent(
			new CustomEvent('language-select', { bubbles: true, detail: lang }),
		)
	}
}
