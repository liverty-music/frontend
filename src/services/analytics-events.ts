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
 */

type EventSource =
	| 'page'
	| 'artist_page'
	| 'search_result'
	| 'recommendation'
	| 'notification'
	| 'discovery_orb'

type BaseProps = {
	/**
	 * OpenTelemetry trace ID of the active span at emission time, if any.
	 * Provides a one-click bridge from the analytics event to the
	 * originating request trace during incident investigation.
	 */
	trace_id?: string
}

/**
 * Page view emitted from the Aurelia router `au:router:navigation-end` event.
 * Replaces PostHog's automatic page-view capture, which is disabled.
 */
export type PageViewedProps = BaseProps & {
	path: string
	title: string
	referrer?: string
}

/**
 * The user opened an artist's detail page. Recorded by the discovery flow
 * for impression measurement against `concert.recommendation.served`.
 */
export type ArtistDiscoveryViewedProps = BaseProps & {
	artist_id: string
	source: EventSource
}

/** The user submitted an artist search query. */
export type ArtistSearchProps = BaseProps & {
	/** Length of the query string; the query text itself is NOT captured. */
	query_length: number
	result_count: number
}

/**
 * The user pressed the follow button. Paired with the backend
 * `artist.follow.completed` to measure intent-to-confirmation latency.
 */
export type ArtistFollowRequestedProps = BaseProps & {
	artist_id: string
	source: EventSource
}

/** The user opened a concert detail page. */
export type ConcertDetailViewedProps = BaseProps & {
	concert_id: string
	artist_id: string
	source: EventSource
}

/**
 * The user clicked a concert recommendation. Paired with the backend
 * `concert.recommendation.served` impression event.
 */
export type ConcertRecommendationClickedProps = BaseProps & {
	concert_id: string
	artist_id: string
	position: number
}

/**
 * The user submitted a ticket lottery entry form. Paired with the backend
 * `ticket.lottery.entry.accepted` / `.rejected` events.
 */
export type TicketLotteryEntrySubmittedProps = BaseProps & {
	concert_id: string
	lottery_round: number
}

/**
 * The user started the ticket purchase flow. Paired with the backend
 * `ticket.purchase.completed` / `.failed` events.
 */
export type TicketPurchaseInitiatedProps = BaseProps & {
	ticket_id: string
	concert_id: string
	price_bucket: string
}

/**
 * The user attempted to check in at a venue gate (ZK proof submission
 * starting). Paired with the backend `entry.zk_proof.verified` / `.rejected`.
 */
export type EntryCheckinAttemptedProps = BaseProps & {
	event_id: string
}

/**
 * The user opted in to Web Push notifications. Paired with the backend
 * `push.subscription.completed`.
 */
export type PushSubscriptionRequestedProps = BaseProps & {
	source: EventSource
}

/** The user tapped a delivered push notification. */
export type PushNotificationOpenedProps = BaseProps & {
	notification_id: string
	concert_id?: string
	artist_id?: string
}

/** The user explicitly dismissed a push notification without opening it. */
export type PushNotificationDismissedProps = BaseProps & {
	notification_id: string
}

/**
 * `Events` is the typed event catalogue. Use it as the only source of
 * event-name literals and property shapes in frontend code:
 *
 *   analytics.capture(Events.ArtistFollowRequested.name, {
 *     artist_id: artist.id.value,
 *     source: 'recommendation',
 *   })
 *
 * The `props` field exists at compile time only; do not access it at runtime.
 */
export const Events = {
	PageViewed: {
		name: 'page.viewed' as const,
		props: undefined as unknown as PageViewedProps,
	},
	ArtistDiscoveryViewed: {
		name: 'artist.discovery.viewed' as const,
		props: undefined as unknown as ArtistDiscoveryViewedProps,
	},
	ArtistSearch: {
		name: 'artist.search' as const,
		props: undefined as unknown as ArtistSearchProps,
	},
	ArtistFollowRequested: {
		name: 'artist.follow.requested' as const,
		props: undefined as unknown as ArtistFollowRequestedProps,
	},
	ConcertDetailViewed: {
		name: 'concert.detail.viewed' as const,
		props: undefined as unknown as ConcertDetailViewedProps,
	},
	ConcertRecommendationClicked: {
		name: 'concert.recommendation.clicked' as const,
		props: undefined as unknown as ConcertRecommendationClickedProps,
	},
	TicketLotteryEntrySubmitted: {
		name: 'ticket.lottery.entry.submitted' as const,
		props: undefined as unknown as TicketLotteryEntrySubmittedProps,
	},
	TicketPurchaseInitiated: {
		name: 'ticket.purchase.initiated' as const,
		props: undefined as unknown as TicketPurchaseInitiatedProps,
	},
	EntryCheckinAttempted: {
		name: 'entry.checkin.attempted' as const,
		props: undefined as unknown as EntryCheckinAttemptedProps,
	},
	PushSubscriptionRequested: {
		name: 'push.subscription.requested' as const,
		props: undefined as unknown as PushSubscriptionRequestedProps,
	},
	PushNotificationOpened: {
		name: 'push.notification.opened' as const,
		props: undefined as unknown as PushNotificationOpenedProps,
	},
	PushNotificationDismissed: {
		name: 'push.notification.dismissed' as const,
		props: undefined as unknown as PushNotificationDismissedProps,
	},
} as const

export type EventName = (typeof Events)[keyof typeof Events]['name']
