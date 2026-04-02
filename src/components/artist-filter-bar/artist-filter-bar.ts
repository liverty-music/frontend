import { bindable } from 'aurelia'
import type { Artist } from '../../entities/artist'

export class ArtistFilterBar {
	@bindable public followedArtists: Artist[] = []
	@bindable({ mode: 'twoWay' }) public selectedIds: string[] = []

	public isSheetOpen = false

	/** Pending selection inside the bottom sheet (committed on confirm). */
	public pendingIds: string[] = []

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
}
