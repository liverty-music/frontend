/**
 * Canonical product-analytics event catalogue emitted from the Aurelia 2 PWA.
 *
 * Every PostHog event sent from the frontend MUST be one of the entries below.
 * Event names follow the convention `domain.action[.outcome]` in dot.case;
 * property keys use `snake_case`. The companion catalogue at
 * `specification/docs/analytics/event-catalog.md` is the source of truth for
 * names, sources (FE/BE), required properties, and consuming dashboards.
 *
 * Trust-critical events (ticket purchase completion, ZK proof verification,
 * push delivery confirmation, account state changes) are emitted from the
 * backend through `backend/internal/usecase/analytics_events.go` and are NOT
 * listed here. Paired events such as `notification.requested` (FE) and
 * `notification.subscribed` (BE) intentionally appear in both catalogues to
 * measure the gap between user intent and server-confirmed outcome.
 *
 * Type-safety contract:
 *
 *   The `Events` map exposes each event as a string-literal name. The
 *   `EventPropsMap` type maps each name literal to its required property
 *   shape. The `EventProps<E>` helper derives the matching property type
 *   from a name literal. Consumers capture events through a single typed
 *   function (provided by the forthcoming AnalyticsService) whose signature
 *   ensures the name and props match at compile time:
 *
 *     capture<E extends EventName>(name: E, props: EventProps<E>): void
 *
 *   Misuse such as `capture(Events.ArtistSearch, someConcertProps)` fails
 *   the typecheck — name and props cannot drift apart.
 *
 * OpenTelemetry trace correlation:
 *
 *   The `trace_id` property is intentionally absent from every payload
 *   type. AnalyticsService injects it from the active OTel span before
 *   handing the event to the PostHog SDK, matching the symmetric pattern
 *   implemented in the backend posthog adapter
 *   (backend/internal/infrastructure/analytics/posthog/posthog_client.go).
 *   Call sites do not need to plumb trace_id manually.
 */

export type EventSource =
	| 'page'
	| 'artist_page'
	| 'search_result'
	| 'dashboard'
	| 'notification'
	| 'discovery_orb'

// -- Per-event property type declarations -------------------------------------

export type ArtistSearchProps = {
	/** Length of the query string; the query text itself is NOT captured. */
	query_length: number
	result_count: number
}

export type ConcertDetailViewedProps = {
	event_id: string
	artist_id: string
	source: EventSource
}

/**
 * The user submitted a ticket lottery entry form. Paired with the backend
 * `ticket.lottery.entry.accepted` / `.rejected` events.
 */
export type TicketLotteryEntrySubmittedProps = {
	event_id: string
	lottery_round: number
}

/**
 * The user started the ticket purchase flow. Paired with the backend
 * `ticket.purchase.completed` / `.failed` events.
 */
export type TicketPurchaseInitiatedProps = {
	ticket_id: string
	event_id: string
	price_bucket: string
}

/**
 * The user attempted to check in at a venue gate (ZK proof submission
 * starting). Paired with the backend `entry.zk_proof.verified` / `.rejected`.
 */
export type EntryCheckinAttemptedProps = {
	event_id: string
}

/**
 * The user opted in to Web Push notifications. Paired with the backend
 * `notification.subscribed`. The underlying transport is the W3C Push API,
 * but the analytics surface stays scoped under the notification domain to
 * align with the user-facing concept.
 */
export type NotificationRequestedProps = {
	source: EventSource
}

export type NotificationOpenedProps = {
	notification_id: string
	event_id?: string
	artist_id?: string
}

export type NotificationDismissedProps = {
	notification_id: string
}

export type WebVitalsProps = {
	/** Metric name: LCP, INP, or CLS. */
	name: 'LCP' | 'INP' | 'CLS'
	/** Value in milliseconds (CLS is unitless 0–∞). */
	value: number
	rating: 'good' | 'needs-improvement' | 'poor'
	/** Soft or hard navigation type. */
	navigation_type: string
	/** Current route pathname at measurement time. */
	route: string
}

export type LongAnimationFrameProps = {
	/** Frame duration in milliseconds (≥ 100ms). */
	duration_ms: number
	/** sourceFunctionName of the longest script in the frame. */
	top_function: string
	/** sourceURL of the longest script in the frame. */
	top_script: string
	/** Route pathname where the long frame occurred. */
	route: string
}

export type SlowInteractionProps = {
	/** Pointer, keyboard, or click event type. */
	interaction_type: string
	/** Interaction processing duration in milliseconds (≥ 150ms). */
	duration_ms: number
	/** Route pathname where the slow interaction occurred. */
	route: string
}

// -- Name catalogue and type-level wiring --------------------------------------

/**
 * `Events` is the canonical mapping from a human-readable code reference to
 * the wire-level event-name literal. Each value is a string literal narrowed
 * via the outer `as const`; no runtime carrier object is allocated for
 * properties.
 *
 *   analytics.capture(Events.ConcertDetailViewed, {
 *     event_id: event.id.value,
 *     artist_id: artist.id.value,
 *     source: 'dashboard',
 *   })
 */
export const Events = {
	ArtistSearch: 'artist.search',
	ConcertDetailViewed: 'concert.detail.viewed',
	TicketLotteryEntrySubmitted: 'ticket.lottery.entry.submitted',
	TicketPurchaseInitiated: 'ticket.purchase.initiated',
	EntryCheckinAttempted: 'entry.checkin.attempted',
	NotificationRequested: 'notification.requested',
	NotificationOpened: 'notification.opened',
	NotificationDismissed: 'notification.dismissed',
	WebVitals: 'web.vitals',
	LongAnimationFrame: 'perf.long_animation_frame',
	SlowInteraction: 'perf.slow_interaction',
} as const satisfies Record<string, string>

/** The union of every valid event-name literal. */
export type EventName = (typeof Events)[keyof typeof Events]

/**
 * Maps each event-name literal to its required property shape. Adding an
 * entry to `Events` requires adding a matching key here; the `satisfies`
 * clause on the line below verifies coverage at compile time.
 */
export type EventPropsMap = {
	'artist.search': ArtistSearchProps
	'concert.detail.viewed': ConcertDetailViewedProps
	'ticket.lottery.entry.submitted': TicketLotteryEntrySubmittedProps
	'ticket.purchase.initiated': TicketPurchaseInitiatedProps
	'entry.checkin.attempted': EntryCheckinAttemptedProps
	'notification.requested': NotificationRequestedProps
	'notification.opened': NotificationOpenedProps
	'notification.dismissed': NotificationDismissedProps
	'web.vitals': WebVitalsProps
	'perf.long_animation_frame': LongAnimationFrameProps
	'perf.slow_interaction': SlowInteractionProps
}

/**
 * Compile-time coverage guarantee: every `EventName` literal MUST appear as
 * a key in `EventPropsMap`. Adding an entry to `Events` without extending
 * `EventPropsMap` makes this assignment fail to typecheck.
 */
const _eventPropsMapCoverage = {} as EventPropsMap satisfies Record<
	EventName,
	unknown
>
void _eventPropsMapCoverage

/**
 * Given an event name literal, returns the required property shape. Use in
 * the typed capture signature:
 *
 *   capture<E extends EventName>(name: E, props: EventProps<E>): void
 */
export type EventProps<E extends EventName> = EventPropsMap[E]
