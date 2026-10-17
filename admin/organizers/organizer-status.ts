import { OrganizerStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'

export { OrganizerStatus }

/**
 * The status as a `data-status` value for styling, or '' when the server did
 * not set it (a backend older than the status field).
 */
export type OrganizerStatusKey = 'provisioning' | 'active' | 'deactivated' | ''

const KEYS: Record<OrganizerStatus, OrganizerStatusKey> = {
	[OrganizerStatus.UNSPECIFIED]: '',
	[OrganizerStatus.PROVISIONING]: 'provisioning',
	[OrganizerStatus.ACTIVE]: 'active',
	[OrganizerStatus.DEACTIVATED]: 'deactivated',
}

const LABELS: Record<OrganizerStatusKey, string> = {
	'': '',
	provisioning: 'Provisioning',
	active: 'Active',
	deactivated: 'Deactivated',
}

export function organizerStatusKey(
	status: OrganizerStatus,
): OrganizerStatusKey {
	return KEYS[status] ?? ''
}

/** The status label shown in the list and the detail; '' when unset. */
export function organizerStatusLabel(status: OrganizerStatus): string {
	return LABELS[organizerStatusKey(status)]
}

/**
 * Whether the Organizer is deactivated: it then offers Delete and none of the
 * controls the server refuses. An unset status behaves as before the status
 * existed (Deactivate offered, every control shown).
 */
export function isOrganizerDeactivated(status: OrganizerStatus): boolean {
	return status === OrganizerStatus.DEACTIVATED
}
