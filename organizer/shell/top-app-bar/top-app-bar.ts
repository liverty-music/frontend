import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../../shared/services/auth-service'
import {
	CONSOLE_LANGUAGES,
	IConsoleLanguage,
} from '../../i18n/console-language'
import type { ConsoleLocale } from '../../i18n/format'
import { IOrganizerClient } from '../../services/organizer-client'

/**
 * The console's top bar: the logo, the Organizer's name, and the account menu
 * holding the language switch and サインアウト.
 */
export class TopAppBar {
	private readonly organizers = resolve(IOrganizerClient)
	private readonly auth = resolve(IAuthService)
	private readonly logger = resolve(ILogger).scopeTo('TopAppBar')
	public readonly language = resolve(IConsoleLanguage)
	public readonly languages = CONSOLE_LANGUAGES

	public organizerName = ''
	public menu!: HTMLElement
	private readonly abort = new AbortController()

	public attached(): void {
		void this.loadOrganizer()
	}

	public detaching(): void {
		this.abort.abort()
	}

	private async loadOrganizer(): Promise<void> {
		try {
			const organizer = await this.organizers.get(this.abort.signal)
			this.organizerName = organizer?.name?.value ?? ''
		} catch (err) {
			// The name is a label only; the screens report their own failures.
			this.logger.warn('Organizer name unavailable', err)
		}
	}

	public async setLanguage(language: ConsoleLocale): Promise<void> {
		await this.language.set(language)
		this.menu.hidePopover()
	}

	public async signOut(): Promise<void> {
		this.menu.hidePopover()
		await this.auth.signOut()
	}
}
