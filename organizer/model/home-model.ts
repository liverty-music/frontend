import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { PayoutOnboardingStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/payout_account_pb.js'
import {
	type Scanner,
	ScannerStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import type { AuthoredSeries } from '../services/series-client'
import {
	concertCancelled,
	concertTitle,
	eventDay,
	eventId,
	eventStart,
	eventsByDate,
	homeArtistOf,
	isDraft,
	isPublished,
	paths,
	seriesId,
} from './concert-model'

export type HomeItemKind = 'payout' | 'scanner' | 'startTime' | 'draft'

/** One thing that needs the operator, with the one action that resolves it. */
export interface HomeItem {
	kind: HomeItemKind
	/** Stable key for the list. */
	key: string
	concertTitle?: string
	/** The event's start (scanner) or day (startTime, draft). */
	when?: Date
	actionHref: string
}

/** Items of one kind, under their subheader on Home. */
export interface HomeGroup {
	kind: HomeItemKind
	items: HomeItem[]
}

/** Groups sorted items by kind, keeping their order (design D18). */
export function groupHomeItems(items: readonly HomeItem[]): HomeGroup[] {
	const groups: HomeGroup[] = []
	for (const item of items) {
		const last = groups.at(-1)
		if (last?.kind === item.kind) last.items.push(item)
		else groups.push({ kind: item.kind, items: [item] })
	}
	return groups
}

const KIND_ORDER: readonly HomeItemKind[] = [
	'payout',
	'scanner',
	'startTime',
	'draft',
]
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** True when the event has a Scanner that staff can still use. */
export function hasLiveScanner(scanners: readonly Scanner[]): boolean {
	return scanners.some(
		(s) =>
			s.status === ScannerStatus.UNUSED || s.status === ScannerStatus.IN_USE,
	)
}

/** Published events that start within the next 7 days. */
export function eventsWithinWeek(
	concerts: readonly AuthoredSeries[],
	now: number,
): Array<{ concert: AuthoredSeries; event: Event; start: Date }> {
	return concerts.flatMap((concert) =>
		concert.events.flatMap((event) => {
			const start = eventStart(event)
			if (!isPublished(event) || !start) return []
			const t = start.getTime()
			return t >= now && t < now + WEEK_MS ? [{ concert, event, start }] : []
		}),
	)
}

export interface HomeSources {
	/** The caller's Organizer, which every item's address names. */
	organizerId: string
	/** The Artists the Organizer represents, by id. */
	represented: ReadonlySet<string>
	concerts: readonly AuthoredSeries[]
	/** Undefined when the payout account could not be read. */
	payoutStatus?: PayoutOnboardingStatus
	/** Scanners of each event starting within the week, by event id. */
	scanners: ReadonlyMap<string, readonly Scanner[]>
}

/**
 * What needs the operator now, most urgent kind first, then by date. An item
 * about a concert opens it under the first of its performers the Organizer
 * represents.
 */
export function homeItems(sources: HomeSources, now: number): HomeItem[] {
	const items: HomeItem[] = []
	const scopeOf = (concert: AuthoredSeries) => ({
		organizer: sources.organizerId,
		artist: homeArtistOf(concert, sources.represented),
	})

	if (
		sources.payoutStatus !== undefined &&
		sources.payoutStatus !== PayoutOnboardingStatus.ACTIVE
	) {
		items.push({
			kind: 'payout',
			key: 'payout',
			actionHref: paths.payout(sources.organizerId),
		})
	}

	const live = sources.concerts.filter((c) => !concertCancelled(c))

	for (const { concert, event, start } of eventsWithinWeek(live, now)) {
		const scanners = sources.scanners.get(eventId(event))
		// An event whose scanners could not be read is not claimed to have none.
		if (!scanners || hasLiveScanner(scanners)) continue
		items.push({
			kind: 'scanner',
			key: `scanner:${eventId(event)}`,
			concertTitle: concertTitle(concert),
			when: start,
			actionHref: paths.scanners(
				scopeOf(concert),
				seriesId(concert),
				eventId(event),
			),
		})
	}

	for (const concert of live) {
		for (const event of eventsByDate(concert)) {
			if (isPublished(event) && !eventStart(event)) {
				items.push({
					kind: 'startTime',
					key: `startTime:${eventId(event)}`,
					concertTitle: concertTitle(concert),
					when: eventDay(event),
					actionHref: paths.editConcert(scopeOf(concert), seriesId(concert)),
				})
			}
		}
		const firstDraft = eventsByDate(concert).find(isDraft)
		if (firstDraft) {
			items.push({
				kind: 'draft',
				key: `draft:${seriesId(concert)}`,
				concertTitle: concertTitle(concert),
				when: eventDay(firstDraft),
				actionHref: paths.concert(scopeOf(concert), seriesId(concert)),
			})
		}
	}

	return items.sort(
		(a, b) =>
			KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
			(a.when?.getTime() ?? 0) - (b.when?.getTime() ?? 0),
	)
}
