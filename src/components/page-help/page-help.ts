import { bindable, resolve } from 'aurelia'
import { IAuthService } from '../../services/auth-service'
import { type GuideMoment, IGuideService } from '../../services/guide-service'

export type PageHelpPage = 'discovery' | 'timetable' | 'my-artists'

/**
 * A page's help sheet, opened only when the fan chooses the action menu's
 * help item; it never opens on its own (page-help "Help never opens on its
 * own"). A section whose feature has a guide moment ends with 「チュートリアル」
 * while that moment's target is on the screen: it closes help and replays the
 * moment, which waits for the sheet to go (a moment never shows under a sheet).
 */
export class PageHelp {
	@bindable public page: PageHelpPage = 'discovery'
	/** Discovery's view on screen: the artist bubbles or the Concerts view. */
	@bindable public view: 'artists' | 'concerts' = 'artists'
	/** My Artists lists at least one followed artist (the 🔥 dots are shown). */
	@bindable public hasArtists = false

	public isOpen = false

	private readonly auth = resolve(IAuthService)
	private readonly guide = resolve(IGuideService)

	/** Discovery's 「ライブ」 section is a signed-in fan's: a guest has no Concerts view. */
	public get isAuthenticated(): boolean {
		return this.auth.isAuthenticated
	}

	/** The bubble field's moment, while the bubbles are shown. */
	public get findingReplay(): GuideMoment | null {
		return this.view === 'artists' ? 'discovery.follow' : null
	}

	/** The swap tile's moment on the bubbles, the filter's on the Concerts view. */
	public get concertsReplay(): GuideMoment {
		return this.view === 'artists' ? 'discovery.swap' : 'concerts.filter'
	}

	/** The hype dots' moment, while a followed artist is listed. */
	public get hypeReplay(): GuideMoment | null {
		return this.hasArtists ? 'myArtists.hype' : null
	}

	public open(): void {
		this.isOpen = true
	}

	/** 「チュートリアル」: close help, then show `moment` on the screen. */
	public replay(moment: GuideMoment): void {
		this.guide.replay(moment)
		this.isOpen = false
	}

	public onSheetClosed(): void {
		this.isOpen = false
	}
}
