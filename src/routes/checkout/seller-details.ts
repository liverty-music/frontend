import type { ResolvedConcert } from '../../adapter/rpc/client/concert-client'

/**
 * The event's Organizer's 特商法 (Specified Commercial Transactions Act)
 * seller details, shown on the checkout's final confirmation.
 *
 * @source proto/liverty_music/entity/v1/organizer.proto — SellerDetails
 */
export interface SellerDetails {
	readonly legalName: string
	readonly representativeName: string
	readonly address: string
	readonly phoneNumber: string
	readonly contactEmail: string
}

/** The seller details carried by the Concert's first-party Series. */
export function sellerDetailsFromConcert(
	concert: ResolvedConcert,
): SellerDetails | null {
	const d = concert.series?.organizer?.sellerDetails
	if (!d) return null
	return {
		legalName: d.legalName,
		representativeName: d.representativeName,
		address: d.address,
		phoneNumber: d.phoneNumber,
		contactEmail: d.contactEmail,
	}
}
