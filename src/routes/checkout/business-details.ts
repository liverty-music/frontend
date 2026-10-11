import type { ResolvedConcert } from '../../adapter/rpc/client/concert-client'

/**
 * The event's Organizer's business details, shown on the checkout's 特商法
 * (Specified Commercial Transactions Act) final confirmation.
 *
 * @source proto/liverty_music/entity/v1/organizer.proto — Organizer
 */
export interface BusinessDetails {
	readonly legalName: string
	readonly representativeName: string
	readonly businessAddress: string
	/** The business phone number in E.164 form. */
	readonly businessPhoneNumber: string
	readonly contactEmail: string
}

/**
 * The business details of the Organizer carried by the Concert's first-party
 * Series, or null when it carries none.
 */
export function businessDetailsFromConcert(
	concert: ResolvedConcert,
): BusinessDetails | null {
	const o = concert.series?.organizer
	if (!o) return null
	const details: BusinessDetails = {
		legalName: o.legalName?.value ?? '',
		representativeName: o.representativeName?.value ?? '',
		businessAddress: o.businessAddress?.value ?? '',
		businessPhoneNumber: o.businessPhoneNumber?.value ?? '',
		contactEmail: o.contactEmail?.value ?? '',
	}
	return Object.values(details).some((v) => v !== '') ? details : null
}
