import { StorageKeys } from '../../constants/storage-keys'
import {
	TICKET_LOOKS,
	type TicketPreset,
} from '../../routes/tickets/virtual-ticket/ticket-presets'

/**
 * The design the fan chose for each virtual ticket, kept on this device only:
 * a map from ticket id to preset name. Another device shows the default.
 */
function load(): Record<string, unknown> {
	try {
		const raw = localStorage.getItem(StorageKeys.ticketPresets)
		const value: unknown = raw ? JSON.parse(raw) : null
		return value && typeof value === 'object'
			? (value as Record<string, unknown>)
			: {}
	} catch {
		// A private window or blocked site data: nothing is kept.
		return {}
	}
}

/** The preset kept for the ticket; `default` when none, or an unknown name, is kept. */
export function loadTicketPreset(ticketId: string): TicketPreset {
	const preset = load()[ticketId]
	return typeof preset === 'string' && Object.hasOwn(TICKET_LOOKS, preset)
		? (preset as TicketPreset)
		: 'default'
}

/** Keep the ticket's preset. A storage that cannot be written keeps nothing. */
export function saveTicketPreset(ticketId: string, preset: TicketPreset): void {
	try {
		const kept = load()
		if (preset === 'default') delete kept[ticketId]
		else kept[ticketId] = preset
		localStorage.setItem(StorageKeys.ticketPresets, JSON.stringify(kept))
	} catch {
		// Nothing to keep on this device.
	}
}

/** Forget every kept preset (sign-out). */
export function clearTicketPresets(): void {
	try {
		localStorage.removeItem(StorageKeys.ticketPresets)
	} catch {
		// Nothing was kept.
	}
}
