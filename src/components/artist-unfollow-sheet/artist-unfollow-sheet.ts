import { I18N } from '@aurelia/i18n'
import { bindable, INode, resolve } from 'aurelia'
import type { MyArtist } from '../../routes/my-artists/my-artists-route'

export class ArtistUnfollowSheet {
	@bindable() public artist: MyArtist | null = null
	@bindable() public open = false

	private readonly host = resolve(INode) as HTMLElement
	private readonly i18n = resolve(I18N)

	public get artistName(): string {
		if (!this.artist) return this.i18n.tr('myArtists.unfollowSheet.sheetLabel')
		return this.i18n.tr('myArtists.unfollowArtist', {
			name: this.artist.artist.name,
		})
	}

	public confirm(): void {
		this.open = false
		this.host.dispatchEvent(
			new CustomEvent('unfollow-confirmed', { bubbles: true }),
		)
	}

	public cancel(): void {
		this.open = false
		this.host.dispatchEvent(new CustomEvent('sheet-closed', { bubbles: true }))
	}
}
