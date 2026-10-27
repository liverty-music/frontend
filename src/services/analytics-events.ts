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

/** Values a ticket event shares: the Event, the TicketType and the count. */
type TicketChoiceProps = {
	event_id: string
	ticket_type_id: string
	ticket_count: number
}

/**
 * The lottery entry screen started the entry (its first
 * LotteryEntryService.AuthorizeCard succeeded).
 */
export type TicketLotteryEntryStartedProps = TicketChoiceProps

/**
 * Confirming the lottery entry succeeded. Paired with the backend
 * `ticket.lottery.result` event.
 */
export type TicketLotteryEntrySubmittedProps = TicketChoiceProps

/**
 * Continuing from the checkout's count step started holding the tickets.
 * Paired with the backend `order.paid` / `checkout.expired` events.
 */
export type TicketPurchaseInitiatedProps = TicketChoiceProps & {
	/** Price band of one ticket; see `priceBucket`. */
	price_bucket: PriceBucket
}

/** Coarse price band of one ticket in yen, 税込. */
export type PriceBucket =
	| 'free'
	| 'under_3000'
	| '3000_5999'
	| '6000_9999'
	| '10000_plus'

export function priceBucket(yen: number): PriceBucket {
	if (yen <= 0) return 'free'
	if (yen < 3000) return 'under_3000'
	if (yen < 6000) return '3000_5999'
	if (yen < 10000) return '6000_9999'
	return '10000_plus'
}

/** The checkout steps that are reported (not loading or a read failure). */
export type ReportedCheckoutStep =
	| 'verify-required'
	| 'count'
	| 'personal-details'
	| 'payment'
	| 'confirm'
	| 'done'
	| 'outcome'

/** The checkout showed one of its steps. */
export type CheckoutStepViewedProps = {
	event_id: string
	ticket_type_id: string
	step: ReportedCheckoutStep
}

/** A visitor tapped `[Get Started]` on the landing page. */
export type OnboardingStartedProps = Record<string, never>

/** The screen or control a sign-up or sign-in was started from. */
export type AuthStartSource =
	| 'welcome'
	| 'dashboard_prompt'
	| 'event_page'
	| 'my_artists_prompt'
	| 'settings'
	| 'auth_status'

/**
 * The app sent the person to hosted login. Paired with the account events
 * the backend sends once the account exists.
 */
export type AuthStartedProps = {
	kind: 'sign_up' | 'sign_in'
	source: AuthStartSource
}

/** A guest's follow took effect (a signed-in follow is reported by the server). */
export type ArtistFollowGuestProps = {
	artist_id: string
	/** Artists the guest follows after this follow. */
	followed_count: number
}

/** Discovery's onboarding progress row reached ready (the link to the Dashboard). */
export type OnboardingTimetableReadyProps = {
	followed_count: number
	artists_with_concerts_count: number
}

/** The merge of a guest's follows into the new account finished. */
export type GuestFollowsMergedProps = {
	merged_count: number
}

/** Where a push-permission request started. */
export type PermissionRequestSource =
	| 'notification_prompt'
	| 'settings'
	| 'post_signup_dialog'
	| 'checkout'

/** The fan answered the browser's push-permission request. */
export type NotificationPermissionResultProps = {
	/** `dismissed`: the request closed without an answer. */
	answer: 'granted' | 'denied' | 'dismissed'
	source: PermissionRequestSource
}

/** The install banner was shown. */
export type PwaInstallBannerShownProps = {
	/** `native`: the device's install request; `guide`: the manual guide. */
	install_mode: 'native' | 'guide'
}

/** The fan started the install from the banner. */
export type PwaInstallAnsweredProps = {
	answer: 'accepted' | 'dismissed' | 'guide_opened'
}

/** The app was installed. */
export type PwaInstalledProps = {
	/** `appinstalled`: the browser reported it; `confirmed`: the fan said so (iOS). */
	via: 'appinstalled' | 'confirmed'
}

/** The fan opened a concert's source link from the event detail sheet. */
export type ConcertSourceClickedProps = {
	event_id: string
	artist_id: string
}

/** The fan used an add-to-calendar control. */
export type ConcertCalendarAddedProps = {
	event_id: string
	artist_id?: string
	surface: 'detail_sheet' | 'event_page'
}

/** The fan used the Event page's share control. */
export type ConcertSharedProps = {
	event_id: string
	method: 'share_sheet' | 'copy_link'
	/** `cancelled` only where the device reports it (the share sheet). */
	outcome: 'completed' | 'cancelled' | 'failed'
}

/**
 * A push notification's interaction, as the pushed message's data states it.
 * An older message without a type is reported without one.
 */
type NotificationInteractionProps = {
	notification_id: string
	/** The Notification's type, e.g. `sales_reminder`. */
	type?: string
	/** A sales reminder's milestone. */
	milestone?: string
	/** Path of the screen the notification opens. */
	path: string
}

export type NotificationOpenedProps = NotificationInteractionProps

export type NotificationDismissedProps = NotificationInteractionProps

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

/**
 * One reporting-window aggregate of client-observed Connect-RPC call telemetry
 * (see the `frontend-client-rpc-telemetry` capability). Emitted at most a few
 * times per session — NOT per RPC. Carries only non-PII observability data:
 * coarse latency-bucket counts, terminal-outcome tallies, and method identity,
 * so p95/p99 (including the auth-retry tail) and the client-side
 * `DeadlineExceeded` rate are computed at query time from the distribution.
 */
export type RpcCallTelemetryProps = {
	/** Wall-clock span of the aggregated window, in ms. */
	window_ms: number
	/** Total RPC calls in the window. */
	total: number
	/** Calls that succeeded. */
	ok: number
	/** Calls aborted by the client-side deadline. */
	deadline_exceeded: number
	/** Calls cancelled intentionally (navigation/unmount). */
	canceled: number
	/** Calls that failed with any other error code. */
	error: number
	/**
	 * Latency-bucket upper-bound (ms, string key) → count for non-empty buckets;
	 * the `overflow` key counts calls slower than the largest bound. The
	 * distribution is shipped as-is; percentiles are computed at query time.
	 */
	buckets: Record<string, number>
	/** RPC method identity → `[total, deadline_exceeded]` compact tally. */
	methods: Record<string, [number, number]>
}

/**
 * Cold-visit Discovery reveal timings: one event per visit that painted ghost
 * placeholder bubbles, sent once every bubble shows an artist name. Each
 * timing is measured from the moment Discovery was opened (see `entry`).
 */
export type DiscoveryRevealProps = {
	/**
	 * `page_load` when Discovery was the document's first route (timings from
	 * `performance.timeOrigin`); `in_app` for an in-app navigation (timings
	 * from the route's `loading()`).
	 */
	entry: 'page_load' | 'in_app'
	/** Initial-load path: global top artists, or similar artists of seeds. */
	path: 'top' | 'seed_similar'
	/** Followed artists used as seeds (0 on the `top` path). */
	seed_count: number
	/**
	 * Until the first bubble was drawn: a ghost placeholder, or an artist when
	 * the artists arrived before any ghost could be drawn.
	 */
	ghosts_ms: number
	/** Until the first artist name was drawn. */
	first_name_ms: number
	/** Until every bubble showed an artist name. */
	all_names_ms: number
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
	TicketLotteryEntryStarted: 'ticket.lottery.entry.started',
	TicketLotteryEntrySubmitted: 'ticket.lottery.entry.submitted',
	TicketPurchaseInitiated: 'ticket.purchase.initiated',
	CheckoutStepViewed: 'checkout.step.viewed',
	OnboardingStarted: 'onboarding.started',
	AuthStarted: 'auth.started',
	ArtistFollowGuest: 'artist.follow.guest',
	OnboardingTimetableReady: 'onboarding.timetable.ready',
	GuestFollowsMerged: 'guest.follows.merged',
	NotificationPermissionResult: 'notification.permission.result',
	PwaInstallBannerShown: 'pwa.install.banner_shown',
	PwaInstallAnswered: 'pwa.install.answered',
	PwaInstalled: 'pwa.installed',
	ConcertSourceClicked: 'concert.source.clicked',
	ConcertCalendarAdded: 'concert.calendar.added',
	ConcertShared: 'concert.shared',
	NotificationOpened: 'notification.opened',
	NotificationDismissed: 'notification.dismissed',
	WebVitals: 'web.vitals',
	LongAnimationFrame: 'perf.long_animation_frame',
	SlowInteraction: 'perf.slow_interaction',
	RpcCallTelemetry: 'perf.rpc_call_telemetry',
	DiscoveryReveal: 'perf.discovery_reveal',
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
	'ticket.lottery.entry.started': TicketLotteryEntryStartedProps
	'ticket.lottery.entry.submitted': TicketLotteryEntrySubmittedProps
	'ticket.purchase.initiated': TicketPurchaseInitiatedProps
	'checkout.step.viewed': CheckoutStepViewedProps
	'onboarding.started': OnboardingStartedProps
	'auth.started': AuthStartedProps
	'artist.follow.guest': ArtistFollowGuestProps
	'onboarding.timetable.ready': OnboardingTimetableReadyProps
	'guest.follows.merged': GuestFollowsMergedProps
	'notification.permission.result': NotificationPermissionResultProps
	'pwa.install.banner_shown': PwaInstallBannerShownProps
	'pwa.install.answered': PwaInstallAnsweredProps
	'pwa.installed': PwaInstalledProps
	'concert.source.clicked': ConcertSourceClickedProps
	'concert.calendar.added': ConcertCalendarAddedProps
	'concert.shared': ConcertSharedProps
	'notification.opened': NotificationOpenedProps
	'notification.dismissed': NotificationDismissedProps
	'web.vitals': WebVitalsProps
	'perf.long_animation_frame': LongAnimationFrameProps
	'perf.slow_interaction': SlowInteractionProps
	'perf.rpc_call_telemetry': RpcCallTelemetryProps
	'perf.discovery_reveal': DiscoveryRevealProps
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
