import type { DatePresetId } from '../../components/all-nearby/date-presets'
import { StorageKeys } from '../../constants/storage-keys'

/**
 * The All Nearby filter the fan chose, kept on this device for the next visit.
 * Only the fan's own input: an area code and a preset id, never a display
 * value.
 */
export interface StoredNearbyFilter {
	/** ISO 3166-2 code, or null to follow the fan's home area. */
	areaCode: string | null
	/** The last applied quick preset; null after a custom range. */
	datePreset: DatePresetId | null
}

const PRESETS: readonly DatePresetId[] = ['weekend', 'week', 'month']
const ISO_3166_2 = /^[A-Z]{2}-[A-Z0-9]{1,3}$/

const EMPTY: StoredNearbyFilter = { areaCode: null, datePreset: null }

/**
 * The kept filter. A missing, malformed or unreadable value (a private window,
 * blocked site data) yields the defaults: the home area and no preset.
 */
export function loadNearbyFilter(): StoredNearbyFilter {
	try {
		const raw = localStorage.getItem(StorageKeys.nearbyFilter)
		if (!raw) return { ...EMPTY }
		const value = JSON.parse(raw) as Partial<Record<string, unknown>>
		const areaCode =
			typeof value.areaCode === 'string' && ISO_3166_2.test(value.areaCode)
				? value.areaCode
				: null
		const datePreset = PRESETS.includes(value.datePreset as DatePresetId)
			? (value.datePreset as DatePresetId)
			: null
		return { areaCode, datePreset }
	} catch {
		return { ...EMPTY }
	}
}

/** Keep `change` on top of what is kept. A storage that cannot be written keeps nothing. */
export function saveNearbyFilter(change: Partial<StoredNearbyFilter>): void {
	try {
		localStorage.setItem(
			StorageKeys.nearbyFilter,
			JSON.stringify({ ...loadNearbyFilter(), ...change }),
		)
	} catch {
		// Nothing to keep on this device.
	}
}

/** Forget the kept filter (sign-in, sign-up, sign-out). */
export function clearNearbyFilter(): void {
	try {
		localStorage.removeItem(StorageKeys.nearbyFilter)
	} catch {
		// Nothing was kept.
	}
}
