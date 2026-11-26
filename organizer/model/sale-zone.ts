import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import type { TicketSale } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	wallOfDateTime,
	zoneOfDateTime,
} from '../../shared/lib/zoned-time/proto'
import { zoneName } from '../../shared/lib/zoned-time/zone-name'
import {
	instantToWall,
	type WallClock,
} from '../../shared/lib/zoned-time/zoned-time'
import type { ConsoleLocale } from '../i18n/format'
import type { FieldOption } from '../ui/console-field/console-field'
import { eventZone } from './concert-model'

/**
 * The time zones a sale may be in: the zones of the venues of the events it
 * names, each once, in the events' order. One zone (the usual case, a sale of
 * one event) is shown as text; several are a select.
 */
export function saleZonesOf(events: readonly Event[]): string[] {
	const zones: string[] = []
	for (const event of events) {
		const zone = eventZone(event)
		if (zone && !zones.includes(zone)) zones.push(zone)
	}
	return zones
}

/** A stored sale's window: its civil date-times and zone. */
export interface StoredSaleWindow {
	readonly start?: WallClock
	readonly end?: WallClock
	readonly zone?: string
}

/** The civil window and zone of a stored sale. */
export function storedWindowOf(sale: TicketSale): StoredSaleWindow {
	return {
		start: sale.saleStartTime ? wallOfDateTime(sale.saleStartTime) : undefined,
		end: sale.saleEndTime ? wallOfDateTime(sale.saleEndTime) : undefined,
		zone: sale.saleStartTime ? zoneOfDateTime(sale.saleStartTime) : undefined,
	}
}

/** `2026-10-10 12:00`, a civil date-time in a message. */
export function wallText(wall: WallClock): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${wall.year}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)}`
}

/** The civil date-time of an instant in `zone`. */
export function wallInZone(instant: Date, zone: string): WallClock {
	return instantToWall(instant, zone)
}

/**
 * The choices of the zone select: none, then each zone by its name. The label
 * is a catalog key whose text is the name given.
 */
export function zoneOptions(
	zones: readonly string[],
	locale: ConsoleLocale,
): FieldOption[] {
	return [
		{ value: '', labelKey: 'saleEditor.zoneNone' },
		...zones.map((zone) => ({
			value: zone,
			labelKey: 'saleEditor.zoneOption',
			params: { name: zoneName(zone, locale) },
		})),
	]
}
