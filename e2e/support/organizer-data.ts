/**
 * Connect JSON builders for organizer RPC responses in functional specs.
 * Field names follow the protobuf JSON mapping (lowerCamelCase, wrapper
 * messages as `{ value }`, enums by name, Timestamps as RFC 3339).
 */

type Json = Record<string, unknown>

export type PublishStateName = 'DRAFT' | 'PUBLISHED' | 'CANCELLED'

export interface EventSpec {
	id: string
	/** `2026-11-03` */
	date: string
	/** `18:00` Japan time; omitted for an event without a start time. */
	start?: string
	venue?: string
	placeId?: string
	state?: PublishStateName
}

export interface ConcertSpec {
	id: string
	title: string
	type?: 'TOUR' | 'SINGLE' | 'FESTIVAL'
	visibility?: 'PUBLIC' | 'UNLISTED'
	state?: PublishStateName
	performers?: Array<{ id: string; name: string }>
	events: EventSpec[]
}

/** A Japan-time wall clock as an RFC 3339 instant. */
export function jst(date: string, time = '00:00'): string {
	return new Date(`${date}T${time}:00+09:00`).toISOString()
}

function event(seriesId: string, e: EventSpec): Json {
	const [year, month, day] = e.date.split('-').map(Number)
	return {
		id: { value: e.id },
		seriesId: { value: seriesId },
		localDate: { value: { year, month, day } },
		...(e.start ? { startTime: { value: jst(e.date, e.start) } } : {}),
		...(e.venue
			? {
					venue: {
						id: { value: `venue-${e.id}` },
						name: { value: e.venue },
						...(e.placeId ? { placeId: { value: e.placeId } } : {}),
					},
				}
			: {}),
		publishState: `PUBLISH_STATE_${e.state ?? 'DRAFT'}`,
	}
}

/** A `SeriesService.List` response. */
export function seriesList(concerts: ConcertSpec[]): Json {
	const artists = new Map<string, string>()
	for (const c of concerts) {
		for (const p of c.performers ?? []) artists.set(p.id, p.name)
	}
	return {
		series: concerts.map((c) => ({
			id: { value: c.id },
			title: { value: c.title },
			type: `SERIES_TYPE_${c.type ?? 'SINGLE'}`,
			visibility: `VISIBILITY_${c.visibility ?? 'PUBLIC'}`,
			publishState: `PUBLISH_STATE_${c.state ?? c.events[0]?.state ?? 'DRAFT'}`,
		})),
		concerts: concerts.flatMap((c) =>
			c.events.map((e) => ({
				event: event(c.id, e),
				artistIds: (c.performers ?? []).map((p) => ({ value: p.id })),
			})),
		),
		artists: [...artists].map(([id, name]) => ({
			id: { value: id },
			name: { value: name },
		})),
	}
}

/** An `OrganizerService.Get` response; `missing` business details are left out. */
export function organizer(
	name = 'XX Records',
	missing: Array<
		| 'legalName'
		| 'representativeName'
		| 'businessAddress'
		| 'businessPhoneNumber'
		| 'contactEmail'
	> = [],
): Json {
	const details: Json = {
		legalName: { value: '株式会社エックス' },
		representativeName: { value: '山田 太郎' },
		businessAddress: { value: '東京都渋谷区神南1-1-1' },
		businessPhoneNumber: { value: '03-0000-0000' },
		contactEmail: { value: 'info@example.com' },
	}
	for (const key of missing) delete details[key]
	return {
		organizer: { id: { value: 'org-1' }, name: { value: name }, ...details },
	}
}

/**
 * An `ArtistService.List` response: the represented Artists, `a-1` for the
 * first name, `a-2` for the second, and so on.
 */
export function artistList(...names: string[]): Json {
	return {
		artists: names.map((name, i) => ({
			id: { value: `a-${i + 1}` },
			name: { value: name },
		})),
	}
}

/** A `PayoutAccountService.Get` response. */
export function payoutAccount(
	status: 'PENDING' | 'ACTIVE' | 'RESTRICTED',
): Json {
	return { payoutAccount: { status: `PAYOUT_ONBOARDING_STATUS_${status}` } }
}

/** The provider's onboarding page that StartOnboarding answers with. */
export const ONBOARDING_URL = 'https://connect.example.com/setup/s_1'

/** A StartOnboarding answer. */
export function onboardingLink(): Json {
	return { onboardingUrl: { value: ONBOARDING_URL } }
}

export interface ScannerSpec {
	id: string
	number: number
	status: 'UNUSED' | 'IN_USE' | 'REVOKED'
	token?: string
	/** RFC 3339 */
	bindTime?: string
}

export function scanner(eventId: string, s: ScannerSpec): Json {
	return {
		id: { value: s.id },
		eventId: { value: eventId },
		number: { value: s.number },
		status: `SCANNER_STATUS_${s.status}`,
		...(s.token ? { linkToken: { value: s.token } } : {}),
		...(s.bindTime ? { bindTime: s.bindTime } : {}),
	}
}

export interface SaleSpec {
	id: string
	name: string
	method: 'LOTTERY' | 'FIRST_COME'
	/** RFC 3339 */
	start: string
	end?: string
	drawTime?: string
	price: number
	quantity: number
	perAccountLimit?: number
	verification?: 'UNSPECIFIED' | 'VERIFIED_ANY' | 'JPKI_ONLY'
	typeState?: 'NOT_YET_ON_SALE' | 'ON_SALE' | 'ALL_HELD' | 'SOLD_OUT' | 'ENDED'
	sold?: number
	held?: number
	stats?: {
		entries: number
		requested: number
		won?: number
		wonTickets?: number
		lost?: number
	}
}

/** A `TicketSaleService.ListByEvent` response. */
export function salesOf(eventId: string, sales: SaleSpec[]): Json {
	return {
		ticketSales: sales.map((s) => ({
			id: { value: s.id },
			name: { value: s.name },
			method: `TICKET_SALE_METHOD_${s.method}`,
			saleStartTime: s.start,
			...(s.end ? { saleEndTime: s.end } : {}),
			...(s.drawTime ? { drawTime: s.drawTime } : {}),
			verificationRequirement: `VERIFICATION_REQUIREMENT_${s.verification ?? 'UNSPECIFIED'}`,
			ticketTypes: [
				{
					id: { value: `type-${s.id}` },
					ticketSaleId: { value: s.id },
					eventId: { value: eventId },
					price: { value: String(s.price) },
					quantity: s.quantity,
					perAccountLimit: s.perAccountLimit ?? 4,
					...(s.sold !== undefined ? { soldCount: s.sold } : {}),
					...(s.held !== undefined ? { heldCount: s.held } : {}),
					state: `TICKET_TYPE_STATE_${s.typeState ?? 'NOT_YET_ON_SALE'}`,
				},
			],
		})),
		lotteryEntryStats: sales
			.filter((s) => s.stats)
			.map((s) => ({
				ticketTypeId: { value: `type-${s.id}` },
				entryCount: s.stats?.entries ?? 0,
				ticketCount: s.stats?.requested ?? 0,
				wonEntryCount: s.stats?.won ?? 0,
				wonTicketCount: s.stats?.wonTickets ?? 0,
				lostEntryCount: s.stats?.lost ?? 0,
			})),
	}
}

/** XX Tour 2026: four dates in November, the first at Zepp Haneda. */
export const XX_TOUR: ConcertSpec = {
	id: 's-tour',
	title: 'XX Tour 2026',
	type: 'TOUR',
	performers: [{ id: 'a-1', name: 'Band A' }],
	events: [
		{
			id: 'e-1103',
			date: '2026-11-03',
			start: '18:00',
			venue: 'Zepp Haneda',
			placeId: 'ChIJ-haneda',
			state: 'PUBLISHED',
		},
		{
			id: 'e-1110',
			date: '2026-11-10',
			start: '18:00',
			venue: 'Zepp Osaka Bayside',
			state: 'PUBLISHED',
		},
		{
			id: 'e-1117',
			date: '2026-11-17',
			start: '18:00',
			venue: 'Zepp Nagoya',
			state: 'PUBLISHED',
		},
		{
			id: 'e-1124',
			date: '2026-11-24',
			start: '18:00',
			venue: 'Zepp Fukuoka',
			state: 'PUBLISHED',
		},
	],
}

/** XX 単独公演: one draft date on 20 December. */
export const XX_SOLO: ConcertSpec = {
	id: 's-solo',
	title: 'XX 単独公演',
	type: 'SINGLE',
	performers: [{ id: 'a-1', name: 'Band A' }],
	events: [
		{
			id: 'e-1220',
			date: '2026-12-20',
			start: '18:00',
			venue: 'Zepp Haneda',
			placeId: 'ChIJ-haneda',
			state: 'DRAFT',
		},
	],
}
