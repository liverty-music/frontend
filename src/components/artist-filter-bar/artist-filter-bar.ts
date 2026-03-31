import { bindable, observable } from 'aurelia'
import type { Artist } from '../../entities/artist'

export class ArtistFilterBar {
	@bindable public followedArtists: Artist[] = []
	@bindable({ mode: 'twoWay' }) public selectedIds: string[] = []

	public isSheetOpen = false

	/** Pending selection inside the bottom sheet (committed on confirm). */
	@observable public pendingIds: string[] = []

	public openSheet(): void {
		this.pendingIds = [...this.selectedIds]
		this.isSheetOpen = true
	}

	public closeSheet(): void {
		this.isSheetOpen = false
	}

	public confirmSelection(): void {
		this.selectedIds = [...this.pendingIds]
		this.isSheetOpen = false
	}

	public togglePending(artistId: string): void {
		const idx = this.pendingIds.indexOf(artistId)
		if (idx === -1) {
			this.pendingIds = [...this.pendingIds, artistId]
		} else {
			this.pendingIds = this.pendingIds.filter((id) => id !== artistId)
		}
	}

	public dismiss(artistId: string): void {
		this.selectedIds = this.selectedIds.filter((id) => id !== artistId)
	}

	public artistNameFor(artistId: string): string {
		return this.followedArtists.find((a) => a.id === artistId)?.name ?? artistId
	}
}
