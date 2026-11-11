import { resolve } from 'aurelia'
import { IAuthService } from '../../../shared/services/auth-service'
import {
	CONSOLE_LANGUAGES,
	IConsoleLanguage,
} from '../../i18n/console-language'
import type { ConsoleLocale } from '../../i18n/format'

/**
 * The account menu at the trailing edge of the top app bar (M3 menu): an
 * icon button that opens the language switch and サインアウト.
 */
export class AccountMenu {
	private readonly auth = resolve(IAuthService)
	public readonly language = resolve(IConsoleLanguage)
	public readonly languages = CONSOLE_LANGUAGES

	public menu!: HTMLElement

	public async setLanguage(language: ConsoleLocale): Promise<void> {
		await this.language.set(language)
		this.menu.hidePopover()
	}

	public async signOut(): Promise<void> {
		this.menu.hidePopover()
		await this.auth.signOut()
	}
}
