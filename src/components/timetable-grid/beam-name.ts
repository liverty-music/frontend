/**
 * View-timeline name that links a concert's card to its laser beam.
 *
 * Derived from the concert id alone, so a card can carry it from the moment it
 * is built and never needs updating: the lane `repeat` is keyed by id, so a
 * card view never changes concert. Whether the name is used — the card only
 * declares the timeline while beams are on and it is matched — is decided by
 * the stylesheet, not by the card.
 *
 * Characters outside an identifier's safe set are replaced so any id yields a
 * valid `<dashed-ident>`.
 */
export function beamTimelineName(concertId: string): string {
	return `--beam-${concertId.replace(/[^A-Za-z0-9_-]/g, '_')}`
}
