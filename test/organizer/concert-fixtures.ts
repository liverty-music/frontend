import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import {
	PublishState,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	TicketSaleMethod,
	TicketSaleSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import {
	type ConcertSpec,
	jst,
	type PublishStateName,
} from '../../e2e/support/organizer-data'
import type { AuthoredSeries } from '../../organizer/services/series-client'
import type { EventTicketSales } from '../../organizer/services/ticket-sale-client'
import { authoredSeries } from './authored-series'

export type { ConcertSpec } from '../../e2e/support/organizer-data'
export { jst, XX_SOLO, XX_TOUR } from '../../e2e/support/organizer-data'

/**
 * The concerts of the console's end-to-end specs (`e2e/support/organizer-data.ts`:
 * XX Tour 2026 and XX 単独公演), as the series client returns them, so a screen
 * test reads the same data as its browser counterpart did.
 */
export function authored(spec: ConcertSpec): AuthoredSeries {
	const publishState = (name: PublishStateName | undefined) =>
		PublishState[name ?? 'DRAFT']
	return authoredSeries({
		series: {
			id: { value: spec.id },
			title: { value: spec.title },
			type: SeriesType[spec.type ?? 'SINGLE'],
			visibility: Visibility[spec.visibility ?? 'PUBLIC'],
			publishState: publishState(spec.state ?? spec.events[0]?.state),
		},
		events: spec.events.map((e) => {
			const [year, month, day] = e.date.split('-').map(Number)
			return {
				id: { value: e.id },
				seriesId: { value: spec.id },
				localDate: { value: { year, month, day } },
				...(e.start
					? {
							startTime: {
								value: timestampFromDate(new Date(jst(e.date, e.start))),
							},
						}
					: {}),
				...(e.venue
					? {
							venue: {
								name: { value: e.venue },
								...(e.placeId ? { placeId: { value: e.placeId } } : {}),
							},
						}
					: {}),
				publishState: publishState(e.state),
				...(e.perAccountLimit !== undefined
					? { perAccountLimit: e.perAccountLimit }
					: {}),
			}
		}),
		performers: (spec.performers ?? []).map((p) => ({
			id: { value: p.id },
			name: { value: p.name },
		})),
	})
}

/** The represented Artists: `a-1` for the first name, `a-2` for the second. */
export function artistsNamed(...names: string[]) {
	return names.map((name, i) =>
		create(ArtistSchema, {
			id: { value: `a-${i + 1}` },
			name: { value: name },
		}),
	)
}

/** A concert's own copy with every date in the given publish state. */
export function allDates(
	spec: ConcertSpec,
	state: PublishStateName,
): ConcertSpec {
	return { ...spec, events: spec.events.map((e) => ({ ...e, state })) }
}

/** The sales an event lists: a lottery open from 20 October to 1 November 2026. */
export function openLottery(eventId: string): EventTicketSales {
	return {
		ticketSales: [
			create(TicketSaleSchema, {
				id: { value: 'sale-1' },
				name: { value: '最速先行' },
				method: TicketSaleMethod.LOTTERY,
				saleStartTime: timestampFromDate(new Date(jst('2026-10-20', '12:00'))),
				saleEndTime: timestampFromDate(new Date(jst('2026-11-01', '23:59'))),
				eventIds: [{ value: eventId }],
			}),
		],
		lotteryEntryStats: [],
		referralCodeStats: [],
	}
}

/** An event's sales when it has none. */
export const NO_SALES: EventTicketSales = {
	ticketSales: [],
	lotteryEntryStats: [],
	referralCodeStats: [],
}
