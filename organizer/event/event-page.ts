import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import type { Organizer } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import {
	eventStart,
	findConcert,
	findEvent,
	isCancelled,
	isPublished,
	performs,
} from '../model/concert-model'
import { IOrganizerClient } from '../services/organizer-client'
import { type AuthoredSeries, ISeriesClient } from '../services/series-client'

export type EventPageState = 'loading' | 'ready' | 'notFound' | 'error'

/** True when every business detail the disclosure shows is registered. */
export function businessDetailsComplete(
	organizer: Organizer | undefined,
): boolean {
	if (!organizer) return false
	return [
		organizer.legalName?.value,
		organizer.representativeName?.value,
		organizer.businessAddress?.value,
		organizer.businessPhoneNumber?.value,
		organizer.contactEmail?.value,
	].every((v) => (v ?? '').trim() !== '')
}

/** Why no sale of an event can be saved yet; each is one notice. */
export type SaleBlock =
	| 'cancelled'
	| 'notPublished'
	| 'noStartTime'
	| 'noStock'
	| 'businessDetails'

/**
 * The reasons, in the order the sale editors show them, that a sale of the
 * event cannot be saved (ticket-sale-editor "Prerequisites explained"): a
 * cancelled or unpublished event, no start time, no TicketStock, incomplete
 * business details.
 */
export function saleBlocksOf(
	event: Event,
	organizer: Organizer | undefined,
	stockCount: number,
): SaleBlock[] {
	const blocks: SaleBlock[] = []
	if (isCancelled(event)) blocks.push('cancelled')
	else if (!isPublished(event)) blocks.push('notPublished')
	if (!eventStart(event)) blocks.push('noStartTime')
	if (stockCount === 0) blocks.push('noStock')
	if (!businessDetailsComplete(organizer)) blocks.push('businessDetails')
	return blocks
}

/**
 * The event page's data, shared by its header and its tabs: the concert, the
 * event and the Organizer (for the business details a sale needs). The event
 * route loads it; the tabs wait for {@link ready}. Under an Artist who does
 * not perform in the concert, the event is not found (design D1).
 */
export class EventPage {
	private readonly series = resolve(ISeriesClient)
	private readonly organizers = resolve(IOrganizerClient)
	private readonly logger = resolve(ILogger).scopeTo('EventPage')

	public state: EventPageState = 'loading'
	public artistId = ''
	public seriesId = ''
	public eventId = ''
	public concert: AuthoredSeries | undefined
	public event: Event | undefined
	public organizer: Organizer | undefined
	public ready: Promise<void> = Promise.resolve()

	/** Set by the event route: opens the publish confirmation in the header. */
	public publishHandler: (() => Promise<void>) | null = null

	public load(
		artistId: string,
		seriesId: string,
		eventId: string,
	): Promise<void> {
		this.artistId = artistId
		this.seriesId = seriesId
		this.eventId = eventId
		this.ready = this.read()
		return this.ready
	}

	public async reload(): Promise<void> {
		await this.load(this.artistId, this.seriesId, this.eventId)
	}

	/** Replaces the concert after a publish, which returns it. */
	public update(concert: AuthoredSeries): void {
		this.concert = concert
		this.event = findEvent(concert, this.eventId)
	}

	public get businessDetailsComplete(): boolean {
		return businessDetailsComplete(this.organizer)
	}

	public async requestPublish(): Promise<void> {
		await this.publishHandler?.()
	}

	private async read(): Promise<void> {
		this.state = 'loading'
		try {
			const [concerts, organizer] = await Promise.all([
				this.series.list(),
				this.organizers.get().catch((err) => {
					// The prerequisite reads "incomplete" when the Organizer is unknown.
					this.logger.warn('Organizer unavailable', err)
					return undefined
				}),
			])
			this.organizer = organizer
			const concert = findConcert(concerts, this.seriesId)
			this.concert =
				concert && performs(concert, this.artistId) ? concert : undefined
			this.event = findEvent(this.concert, this.eventId)
			this.state = this.event ? 'ready' : 'notFound'
		} catch (err) {
			this.logger.warn('Event unavailable', err)
			this.state = 'error'
		}
	}
}

export const IEventPage = DI.createInterface<IEventPage>('IEventPage', (x) =>
	x.singleton(EventPage),
)
export interface IEventPage extends EventPage {}
