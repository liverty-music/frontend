import { bindable, resolve } from 'aurelia'
import { IAuthService } from '../../../shared/services/auth-service'
import { guideHref } from '../../guide/guide-link'
import {
	CONSOLE_LANGUAGES,
	IConsoleLanguage,
} from '../../i18n/console-language'
import type { ConsoleLocale } from '../../i18n/format'
import { paths } from '../../model/concert-model'
import { IBreadcrumbs } from '../breadcrumbs'
import { IConsoleContext } from '../console-context'

/** One represented Artist in the Artist menu. */
export interface ArtistChoice {
	readonly id: string
	readonly name: string
	readonly href: string
}

/**
 * The console's top app bar (M3 small top app bar). At its start, on a
 * compact window below a destination, a back arrow to the parent page and the
 * page's title (the breadcrumb's place there); otherwise the brand lockup
 * Liverty Music / Organizer Console (design D20), which on a medium or wider
 * window sits above the navigation rail. Then the Organizer's name and the
 * Artist being worked on — a menu listing the represented Artists when there
 * are two or more (M3 menu), its name only with one — and, at the trailing
 * edge, 使い方 and the account menu holding the language switch and
 * サインアウト. 使い方 opens the members' guide at the current screen's chapter
 * in a new tab, so an editor's unsaved input stays (design D4).
 */
export class TopAppBar {
	private readonly auth = resolve(IAuthService)
	public readonly context = resolve(IConsoleContext)
	public readonly breadcrumbs = resolve(IBreadcrumbs)
	public readonly language = resolve(IConsoleLanguage)
	public readonly languages = CONSOLE_LANGUAGES

	/** The guide at the current screen's chapter; the shell sets it per page. */
	@bindable public helpHref = guideHref('home')

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
