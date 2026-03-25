/**
 * Curated artist IDs for the Welcome page dashboard preview.
 * These are popular Japanese artists likely to have upcoming concerts.
 * The list is kept at 10-15 entries so that fetching stops as soon as
 * enough concerts are found (≥3 artists with upcoming events).
 *
 * NOTE: Replace these placeholder IDs with real artist IDs from the backend
 * (e.g. via GET /artists?name=Mrs.GREEN+APPLE).
 */
export const PREVIEW_ARTIST_IDS: readonly string[] = [
	// Mrs. GREEN APPLE
	'preview-mrs-green-apple',
	// YOASOBI
	'preview-yoasobi',
	// Vaundy
	'preview-vaundy',
	// Super Beaver
	'preview-super-beaver',
	// King Gnu
	'preview-king-gnu',
	// Official髭男dism
	'preview-official-hige-dandism',
	// Ano
	'preview-ano',
	// Creepy Nuts
	'preview-creepy-nuts',
	// Ado
	'preview-ado',
	// back number
	'preview-back-number',
	// ONE OK ROCK
	'preview-one-ok-rock',
	// RADWIMPS
	'preview-radwimps',
]

/** Minimum number of artists with concerts required to show the preview. */
export const PREVIEW_MIN_ARTISTS_WITH_CONCERTS = 3
