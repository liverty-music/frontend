/** Fanart image URLs resolved from the artist's fanart.tv data. */
export interface Fanart {
	artistThumb?: string
	artistBackground?: string
	hdMusicLogo?: string
	musicLogo?: string
	musicBanner?: string
}

/** A music artist with optional fanart imagery. */
export interface Artist {
	id: string
	name: string
	mbid: string
	fanart?: Fanart
}
