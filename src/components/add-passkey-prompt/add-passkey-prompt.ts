import { resolve } from 'aurelia'
import { IAddPasskeyPromptService } from '../../services/add-passkey-prompt-service'

/**
 * The add-passkey prompt shown after a Log In on a device without a passkey
 * record (design D10). The state and the three choices live in
 * AddPasskeyPromptService; this element only presents them. Dismissing the
 * sheet counts as "Later".
 */
export class AddPasskeyPrompt {
	public readonly prompt = resolve(IAddPasskeyPromptService)

	/** Create a passkey here and come back to the screen the fan is on. */
	public create(): void {
		const { pathname, search } = window.location
		this.prompt.createOnThisDevice(`${pathname}${search}`)
	}

	public alreadyHasOne(): void {
		this.prompt.alreadyHasOne()
	}

	public later(): void {
		this.prompt.later()
	}

	/** The sheet was dismissed (swipe, tap outside, Escape). */
	public dismissed(): void {
		if (this.prompt.open) this.prompt.later()
	}
}
