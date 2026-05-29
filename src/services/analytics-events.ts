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
 * listed here. Paired events such as `artist.follow.requested` (FE) and
 * `artist.follow.completed` (BE) intentionally appear in both catalogues to
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
 *   Misuse such as `capture(Events.PageViewed, somePurchaseProps)` fails
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

type EventSource =
	| 'page'
	| 'artist_page'
	| 'search_result'
	| 'recommendation'
	| 'notification'
	| 'discovery_orb'

// -- Per-event property type declarations -------------------------------------

/**
 * Page view emitted from the Aurelia router `au:router:navigation-end` event.
 * Replaces PostHog's automatic page-view capture, which is disabled.
 */
export type PageViewedProps = {
	path: string
	title: string
	referrer?: string
}

/**
 * The user clicked the signup CTA or otherwise entered the signup flow.
 * Paired with the backend `account.signup.completed` to measure the
 * signup funnel.
 */
export type AccountSignupStartedProps = {
	source: 'landing' | 'cta' | 'deep_link' | 'post_signup_dialog'
}

/**
 * The user opened an artist's detail page. Recorded by the discovery flow
 * for impression measurement against `concert.recommendation.served`.
 */
export type ArtistDiscoveryViewedProps = {
	artist_id: string
	source: EventSource
}

/** The user submitted an artist search query. */
export type ArtistSearchProps = {
	/** Length of the query string; the query text itself is NOT captured. */
	query_length: number
	result_count: number
}

/**
 * The user pressed the follow button. Paired with the backend
 * `artist.follow.completed` to measure intent-to-confirmation latency.
 */
export type ArtistFollowRequestedProps = {
	artist_id: string
	source: EventSource
}

/** The user opened a concert detail page. */
export type ConcertDetailViewedProps = {
	concert_id: string
	artist_id: string
	source: EventSource
}

/**
 * The user clicked a concert recommendation. Paired with the backend
 * `concert.recommendation.served` impression event.
 */
export type ConcertRecommendationClickedProps = {
	concert_id: string
	artist_id: string
	position: number
}

/**
 * The user submitted a ticket lottery entry form. Paired with the backend
 * `ticket.lottery.entry.accepted` / `.rejected` events.
 */
export type TicketLotteryEntrySubmittedProps = {
	concert_id: string
	lottery_round: number
}

/**
 * The user started the ticket purchase flow. Paired with the backend
 * `ticket.purchase.completed` / `.failed` events.
 */
export type TicketPurchaseInitiatedProps = {
	ticket_id: string
	concert_id: string
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
 * `push.subscription.completed`.
 */
export type PushSubscriptionRequestedProps = {
	source: EventSource
}

/** The user tapped a delivered push notification. */
export type PushNotificationOpenedProps = {
	notification_id: string
	concert_id?: string
	artist_id?: string
}

/** The user explicitly dismissed a push notification without opening it. */
export type PushNotificationDismissedProps = {
	notification_id: string
}

// -- Name catalogue and type-level wiring --------------------------------------

/**
 * `Events` is the canonical mapping from a human-readable code reference to
 * the wire-level event-name literal. Each value is a string literal narrowed
 * via the outer `as const`; no runtime carrier object is allocated for
 * properties.
 *
 *   analytics.capture(Events.ArtistFollowRequested, {
 *     artist_id: artist.id.value,
 *     source: 'recommendation',
 *   })
 */
export const Events = {
	PageViewed: 'page.viewed',
	AccountSignupStarted: 'account.signup.started',
	ArtistDiscoveryViewed: 'artist.discovery.viewed',
	ArtistSearch: 'artist.search',
	ArtistFollowRequested: 'artist.follow.requested',
	ConcertDetailViewed: 'concert.detail.viewed',
	ConcertRecommendationClicked: 'concert.recommendation.clicked',
	TicketLotteryEntrySubmitted: 'ticket.lottery.entry.submitted',
	TicketPurchaseInitiated: 'ticket.purchase.initiated',
	EntryCheckinAttempted: 'entry.checkin.attempted',
	PushSubscriptionRequested: 'push.subscription.requested',
	PushNotificationOpened: 'push.notification.opened',
	PushNotificationDismissed: 'push.notification.dismissed',
} as const satisfies Record<string, string>

/** The union of every valid event-name literal. */
export type EventName = (typeof Events)[keyof typeof Events]

/**
 * Maps each event-name literal to its required property shape. Adding an
 * entry to `Events` requires adding a matching key here; the `satisfies`
 * clause on the line below verifies coverage at compile time.
 */
export type EventPropsMap = {
	'page.viewed': PageViewedProps
	'account.signup.started': AccountSignupStartedProps
	'artist.discovery.viewed': ArtistDiscoveryViewedProps
	'artist.search': ArtistSearchProps
	'artist.follow.requested': ArtistFollowRequestedProps
	'concert.detail.viewed': ConcertDetailViewedProps
	'concert.recommendation.clicked': ConcertRecommendationClickedProps
	'ticket.lottery.entry.submitted': TicketLotteryEntrySubmittedProps
	'ticket.purchase.initiated': TicketPurchaseInitiatedProps
	'entry.checkin.attempted': EntryCheckinAttemptedProps
	'push.subscription.requested': PushSubscriptionRequestedProps
	'push.notification.opened': PushNotificationOpenedProps
	'push.notification.dismissed': PushNotificationDismissedProps
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
