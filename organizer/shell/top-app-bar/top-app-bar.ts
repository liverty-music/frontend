import { resolve } from 'aurelia'
import { IAuthService } from '../../../shared/services/auth-service'
import {
	CONSOLE_LANGUAGES,
	IConsoleLanguage,
} from '../../i18n/console-language'
import type { ConsoleLocale } from '../../i18n/format'
import { paths } from '../../model/concert-model'
import { IConsoleContext } from '../console-context'

/** One represented Artist in the Artist menu. */
export interface ArtistChoice {
	readonly id: string
	readonly name: string
	readonly href: string
}

/**
 * The console's top bar: the logo, the Organizer's name, the Artist being
 * worked on — a menu listing the represented Artists when there are two or
 * more (M3 menu), its name only with one — and the account menu holding the
 * language switch and サインアウト.
 */
export class TopAppBar {
	private readonly auth = resolve(IAuthService)
	public readonly context = resolve(IConsoleContext)
	public readonly language = resolve(IConsoleLanguage)
	public readonly languages = CONSOLE_LANGUAGES

	public menu!: HTMLElement
	public artistMenu!: HTMLElement

	/** The represented Artists, each linking to its concerts. */
	public get artists(): ArtistChoice[] {
		const organizer = this.context.organizerId
		return this.context.artists.map((a) => {
			const id = a.id?.value ?? ''
			return {
				id,
				name: a.name?.value ?? '',
				href: paths.concerts({ organizer, artist: id }),
			}
		})
	}

	public get artistName(): string {
		return this.context.artist?.name?.value ?? ''
	}

	/** Closes the Artist menu; the chosen link navigates. */
	public chooseArtist(): boolean {
		this.artistMenu.hidePopover()
		return true
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
