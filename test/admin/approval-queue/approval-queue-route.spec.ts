import { createFixture } from '@aurelia/testing'
import {
	type ApproveResponse,
	ApproveResponseSchema,
	type ConcertCandidate,
	ConcertCandidateSchema,
	Resolution,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/concert_candidate/v1/concert_candidate_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The route resolves IConcertCandidateClient. Replace the real module (which would build
// a Connect transport over the generated client) with a fresh interface token +
// a no-op class so the fixture binds to the test double.
const IConcertCandidateClient = DI.createInterface('IConcertCandidateClient')

vi.mock('../../../admin/services/concert-candidate-client', () => ({
	IConcertCandidateClient,
}))

const IAreaClient = DI.createInterface('IAreaClient')
vi.mock('../../../admin/services/area-client', () => ({ IAreaClient }))

const { ApprovalQueueRoute } = await import(
	'../../../admin/approval-queue/approval-queue-route'
)

interface MockClient {
	list: ReturnType<typeof vi.fn>
	approve: ReturnType<typeof vi.fn>
	reject: ReturnType<typeof vi.fn>
}

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
	return {
		list: vi.fn().mockResolvedValue([]),
		// approve resolves to an ApproveResponse; no conflict = published.
		approve: vi.fn().mockResolvedValue(create(ApproveResponseSchema, {})),
		reject: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

/** Builds an ApproveResponse carrying a duplicate conflict against a candidate row. */
function conflictResponse(candidate: ConcertCandidate): ApproveResponse {
	return create(ApproveResponseSchema, {
		conflict: {
			existing: {
				eventId: { value: 'event-existing' },
				title: { value: 'Existing Title' },
				listedVenueName: { value: 'Existing Venue' },
				localDate: {
					value: { year: 2026, month: 7, day: 4 },
				},
			},
			concertCandidate: candidate,
		},
	})
}

function makeConcert(opts: {
	concertCandidateId: string
	artist: string
	title: string
	year: number
	month: number
	day: number
	/** The resolved place id; none when absent. */
	placeId?: string
	/** The admin area; JP-13 when absent, none when null. */
	adminArea?: string | null
	/** The time zone; Asia/Tokyo when absent, none when null. */
	timeZone?: string | null
	sourceUrl?: string
	openTime?: { hours: number; minutes: number }
	startTime?: { hours: number; minutes: number }
}): ConcertCandidate {
	return create(ConcertCandidateSchema, {
		id: { value: opts.concertCandidateId },
		performer: {
			name: { value: opts.artist },
		},
		title: { value: opts.title },
		localDate: {
			value: {
				year: opts.year,
				month: opts.month,
				day: opts.day,
			},
		},
		listedVenueName: { value: 'listed venue' },
		adminArea:
			opts.adminArea === null
				? undefined
				: { value: opts.adminArea ?? 'JP-13' },
		timeZone:
			opts.timeZone === null
				? undefined
				: { value: opts.timeZone ?? 'Asia/Tokyo' },
		resolvedPlaceId: opts.placeId ? { value: opts.placeId } : undefined,
		sourceUrl: opts.sourceUrl ? { value: opts.sourceUrl } : undefined,
		openTime: opts.openTime ? { value: opts.openTime } : undefined,
		startTime: opts.startTime ? { value: opts.startTime } : undefined,
		findTime: timestampFromDate(new Date('2026-06-01T12:00:00Z')),
	})
}

function resolvedConcert(): ConcertCandidate {
	return makeConcert({
		concertCandidateId: 'candidate-1',
		artist: 'The Resolved Band',
		title: 'Summer Tour',
		year: 2026,
		month: 7,
		day: 4,
		placeId: 'ChIJNipponBudokan',
		adminArea: 'JP-13',
		sourceUrl: 'https://example.com/show/1',
	})
}

function unresolvedConcert(): ConcertCandidate {
	return makeConcert({
		concertCandidateId: 'candidate-2',
		artist: 'No Venue Act',
		title: 'Mystery Gig',
		year: 2026,
		month: 8,
		day: 9,
		sourceUrl: 'https://example.com/show/2',
	})
}

const ERROR_MESSAGES_SPEC =
	'components/infrastructure/admin/web/global/error-messages'

interface MockAreaClient {
	resolve: ReturnType<typeof vi.fn>
	listByCountry: ReturnType<typeof vi.fn>
}

const tokyo = {
	code: { value: 'JP-13' },
	countryCode: { value: 'JP' },
	timeZone: { value: 'Asia/Tokyo' },
}
const osaka = {
	code: { value: 'JP-27' },
	countryCode: { value: 'JP' },
	timeZone: { value: 'Asia/Tokyo' },
}
const texas = { code: { value: 'US-TX' }, countryCode: { value: 'US' } }
const countries: Record<string, unknown> = {
	JP: {
		areas: [tokyo, osaka],
		timeZones: [
			{ timeZone: { value: 'Asia/Tokyo' }, nameEn: 'Japan', nameJa: '日本' },
		],
	},
	US: {
		areas: [texas],
		timeZones: [
			{
				timeZone: { value: 'America/Chicago' },
				nameEn: 'Chicago',
				nameJa: 'シカゴ',
			},
			{
				timeZone: { value: 'America/Denver' },
				nameEn: 'Denver',
				nameJa: 'デンバー',
			},
		],
	},
}

/** An AreaService double that knows Tokyo, Osaka and Texas by code or name. */
function createMockAreaClient(): MockAreaClient {
	const byText: Record<string, unknown> = {
		東京都: tokyo,
		'JP-13': tokyo,
		'JP-27': osaka,
		Texas: texas,
	}
	return {
		resolve: vi.fn(async (text: string) => byText[text] ?? null),
		listByCountry: vi.fn(async (code: string) => countries[code]),
	}
}

async function build(client: MockClient, areaClient = createMockAreaClient()) {
	const fixture = createFixture
		.html('<approval-queue-route component.ref="route"></approval-queue-route>')
		.deps(
			ApprovalQueueRoute,
			Registration.instance(IConcertCandidateClient, client),
			Registration.instance(IAreaClient, areaClient),
		)
		.build()
	await fixture.started
	return fixture
}

function routeOf(
	fixture: Awaited<ReturnType<typeof build>>,
): InstanceType<typeof ApprovalQueueRoute> {
	return (
		fixture.component as { route: InstanceType<typeof ApprovalQueueRoute> }
	).route
}

describe('ApprovalQueueRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('grouping', () => {
		// @spec components/infrastructure/admin/web/route/approval-queue "Reviewer sees pending concerts grouped by artist and series"
		it('groups concerts by artist and then by title', async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([
					makeConcert({
						concertCandidateId: 's1',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 1,
						placeId: 'ChIJVenue1',
						adminArea: 'JP-13',
					}),
					makeConcert({
						concertCandidateId: 's2',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 2,
						placeId: 'ChIJVenue2',
						adminArea: 'JP-14',
					}),
					makeConcert({
						concertCandidateId: 's3',
						artist: 'Band A',
						title: 'Tour Y',
						year: 2026,
						month: 8,
						day: 1,
					}),
					makeConcert({
						concertCandidateId: 's4',
						artist: 'Band B',
						title: 'Festival',
						year: 2026,
						month: 9,
						day: 1,
						placeId: 'ChIJVenue3',
						adminArea: 'JP-27',
					}),
				]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			expect(vm.groups).toHaveLength(2)

			const bandA = vm.groups[0]
			expect(bandA.artistName).toBe('Band A')
			expect(bandA.series).toHaveLength(2)
			expect(bandA.series[0].seriesTitle).toBe('Tour X')
			expect(bandA.series[0].rows).toHaveLength(2)
			expect(bandA.series[1].seriesTitle).toBe('Tour Y')
			expect(bandA.series[1].rows).toHaveLength(1)

			const bandB = vm.groups[1]
			expect(bandB.artistName).toBe('Band B')
			expect(bandB.series).toHaveLength(1)
			expect(bandB.series[0].seriesTitle).toBe('Festival')
		})

		it('computes unresolvedCount for concerts without a resolved venue', async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([
					makeConcert({
						concertCandidateId: 's1',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 1,
						placeId: 'ChIJVenue1',
						adminArea: 'JP-13',
					}),
					makeConcert({
						concertCandidateId: 's2',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 2,
					}),
					makeConcert({
						concertCandidateId: 's3',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 3,
					}),
				]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const series = vm.groups[0].series[0]
			expect(series.rows).toHaveLength(3)
			expect(series.unresolvedCount).toBe(2)
		})
	})

	describe('rendering', () => {
		// @spec components/infrastructure/admin/web/route/approval-queue "Expanding a series reveals per-concert review rows"
		it('renders reviewable fields for resolved and unresolved rows', async () => {
			const client = createMockClient({
				list: vi
					.fn()
					.mockResolvedValue([resolvedConcert(), unresolvedConcert()]),
			})
			const fixture = await build(client)

			const text = fixture.appHost.textContent ?? ''
			// Artist and title appear as group headers.
			expect(text).toContain('The Resolved Band')
			expect(text).toContain('Summer Tour')
			// Per-row fields are still shown in expanded rows.
			expect(text).toContain('2026-07-04')
			expect(text).toContain('listed venue')
			expect(text).toContain('JP-13')
			expect(text).toContain('Asia/Tokyo')
			// The resolved place opens in Google Maps by its place id; no
			// catalog name is shown.
			const place = fixture.appHost.querySelector<HTMLAnchorElement>(
				'a.approval-queue-place-link',
			)
			expect(place?.href).toContain('query_place_id=ChIJNipponBudokan')
			// Unresolved row is clearly flagged for review.
			expect(text).toContain('Unresolved venue — review')
			// Source link renders with the raw URL.
			const links = Array.from(
				fixture.appHost.querySelectorAll<HTMLAnchorElement>(
					'a.approval-queue-source-link',
				),
			)
			expect(links.map((a) => a.href)).toContain('https://example.com/show/1')
		})

		it('shows unresolved badge in series summary when unresolvedCount > 0', async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([unresolvedConcert()]),
			})
			const fixture = await build(client)

			expect(fixture.appHost.textContent).toContain('⚠')
			expect(fixture.appHost.textContent).toContain('unresolved')
		})

		it('does not render a source link for a javascript: URL (XSS guard)', async () => {
			const malicious = makeConcert({
				concertCandidateId: 'candidate-xss',
				artist: 'Sketchy Act',
				title: 'Suspicious Show',
				year: 2026,
				month: 9,
				day: 1,
				// AI-sourced URL carrying a script payload — must be neutralised.
				sourceUrl: 'javascript:alert(document.cookie)',
			})
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([malicious]),
			})
			const fixture = await build(client)

			// sanitizeUrl() reduces the javascript: scheme to '', so if.bind hides
			// the anchor entirely — no dangerous href reaches the DOM.
			const links = fixture.appHost.querySelectorAll(
				'a.approval-queue-source-link',
			)
			expect(links).toHaveLength(0)
		})

		it('renders the empty state when no concerts are pending', async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([]),
			})
			const fixture = await build(client)

			expect(fixture.appHost.textContent).toContain(
				'No concerts awaiting review',
			)
		})

		it('shows the error state when the initial list fails', async () => {
			const client = createMockClient({
				list: vi.fn().mockRejectedValue(new Error('boom')),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			expect(vm.phase).toBe('error')
			expect(fixture.appHost.textContent).toContain(
				'Could not load the approval queue',
			)
			expect(fixture.appHost.textContent).toContain(
				'Failed to load the approval queue.',
			)
			expect(fixture.appHost.textContent).not.toContain('boom')
		})

		it(`@spec ${ERROR_MESSAGES_SPEC} "Session expired during a call"`, async () => {
			const client = createMockClient({
				list: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('token "exp" not satisfied', Code.Unauthenticated),
					),
			})
			const fixture = await build(client)
			await fixture.tasksSettled

			expect(routeOf(fixture).loadError).toBe(
				'Your session expired — signing you back in…',
			)
			expect(fixture.appHost.textContent).toContain(
				'Your session expired — signing you back in…',
			)
			expect(fixture.appHost.textContent).not.toContain('not satisfied')
		})
	})

	describe('approve', () => {
		// @spec components/infrastructure/admin/web/route/approval-queue "Reviewer approves an item"
		it('calls approve(id) and removes the row, pruning empty series and artist groups', async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([resolvedConcert()]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			expect(series.rows).toHaveLength(1)

			await vm.approve(group, series, row)

			expect(client.approve).toHaveBeenCalledWith(
				'candidate-1',
				Resolution.UNSPECIFIED,
				expect.anything(),
			)
			// Row removed → series pruned → artist group pruned.
			expect(vm.groups).toHaveLength(0)
		})

		it('decrements unresolvedCount when an unresolved row is approved', async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([
					makeConcert({
						concertCandidateId: 's1',
						artist: 'Band A',
						title: 'Tour',
						year: 2026,
						month: 7,
						day: 1,
					}),
					makeConcert({
						concertCandidateId: 's2',
						artist: 'Band A',
						title: 'Tour',
						year: 2026,
						month: 7,
						day: 2,
					}),
				]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			expect(series.unresolvedCount).toBe(2)

			await vm.approve(group, series, series.rows[0])

			expect(series.unresolvedCount).toBe(1)
			expect(series.rows).toHaveLength(1)
		})

		it('surfaces a per-row error and keeps the row when approve fails', async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([resolvedConcert()]),
				approve: vi.fn().mockRejectedValue(new Error('approve failed')),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			await vm.approve(group, series, row)

			expect(row.actionError).toBe('Approval failed. Try again.')
			expect(row.busy).toBe(false)
			expect(series.rows).toHaveLength(1)
		})

		it(`@spec ${ERROR_MESSAGES_SPEC} "Server message stays off the screen"`, async () => {
			const err = new ConnectError(
				'begin transaction: connection reset (internal)',
				Code.Internal,
			)
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([resolvedConcert()]),
				approve: vi.fn().mockRejectedValue(err),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)
			// The route's scoped logger writes to the browser console.
			// biome-ignore lint/complexity/useLiteralKeys: logger is private; bracket access is the type-checked way to reach it
			const logError = vi.spyOn(vm['logger'], 'error')
			await fixture.tasksSettled

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			await vm.approve(group, series, row)
			await fixture.tasksSettled

			expect(row.actionError).toBe('Approval failed. Try again.')
			expect(fixture.appHost.textContent).toContain(
				'Approval failed. Try again.',
			)
			expect(fixture.appHost.textContent).not.toContain('connection reset')
			expect(logError).toHaveBeenCalledWith(
				'Approve failed',
				expect.objectContaining({ err }),
			)
		})

		it('prunes only the empty series, not the artist group, when another series remains', async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([
					makeConcert({
						concertCandidateId: 's1',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 1,
						placeId: 'ChIJVenue',
						adminArea: 'JP-13',
					}),
					makeConcert({
						concertCandidateId: 's2',
						artist: 'Band A',
						title: 'Tour Y',
						year: 2026,
						month: 8,
						day: 1,
						placeId: 'ChIJVenue',
						adminArea: 'JP-14',
					}),
				]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const seriesX = group.series[0]
			await vm.approve(group, seriesX, seriesX.rows[0])

			// Tour X is pruned but Band A remains with Tour Y.
			expect(vm.groups).toHaveLength(1)
			expect(vm.groups[0].series).toHaveLength(1)
			expect(vm.groups[0].series[0].seriesTitle).toBe('Tour Y')
		})
	})

	describe('duplicate reconciliation', () => {
		it('opens the conflict dialog without mutating when approve returns a conflict', async () => {
			const candidate = resolvedConcert()
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([candidate]),
				approve: vi.fn().mockResolvedValue(conflictResponse(candidate)),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			await vm.approve(group, series, row)

			// First call used UNSPECIFIED; conflict surfaced; row kept.
			expect(client.approve).toHaveBeenCalledWith(
				'candidate-1',
				Resolution.UNSPECIFIED,
				expect.anything(),
			)
			expect(vm.conflictView).not.toBeNull()
			expect(vm.conflictView?.existingTitle).toBe('Existing Title')
			expect(vm.conflictView?.existingListedVenueName).toBe('Existing Venue')
			expect(vm.conflictView?.candidateTitle).toBe('Summer Tour')
			expect(row.busy).toBe(false)
			expect(vm.groups).toHaveLength(1)
		})

		it('KEEP_EXISTING re-calls approve and removes the row', async () => {
			const candidate = resolvedConcert()
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([candidate]),
				approve: vi
					.fn()
					.mockResolvedValueOnce(conflictResponse(candidate))
					.mockResolvedValueOnce(create(ApproveResponseSchema, {})),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			await vm.approve(group, series, series.rows[0])
			await vm.keepExisting()

			expect(client.approve).toHaveBeenNthCalledWith(
				2,
				'candidate-1',
				Resolution.KEEP_EXISTING,
				expect.anything(),
			)
			expect(vm.conflictView).toBeNull()
			expect(vm.groups).toHaveLength(0)
		})

		it('adopting the candidate re-calls approve and removes the row', async () => {
			const candidate = resolvedConcert()
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([candidate]),
				approve: vi
					.fn()
					.mockResolvedValueOnce(conflictResponse(candidate))
					.mockResolvedValueOnce(create(ApproveResponseSchema, {})),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			await vm.approve(group, series, series.rows[0])
			await vm.adoptCandidate()

			expect(client.approve).toHaveBeenNthCalledWith(
				2,
				'candidate-1',
				Resolution.ADOPT_CANDIDATE,
				expect.anything(),
			)
			expect(vm.conflictView).toBeNull()
			expect(vm.groups).toHaveLength(0)
		})

		it('cancel keeps the row and closes the dialog', async () => {
			const candidate = resolvedConcert()
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([candidate]),
				approve: vi.fn().mockResolvedValue(conflictResponse(candidate)),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			await vm.approve(group, series, series.rows[0])
			vm.cancelConflict()

			// Only the initial UNSPECIFIED call; row still present.
			expect(client.approve).toHaveBeenCalledTimes(1)
			expect(vm.conflictView).toBeNull()
			expect(vm.groups).toHaveLength(1)
		})

		it('keeps the dialog open and surfaces an error when reconciliation fails', async () => {
			const candidate = resolvedConcert()
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([candidate]),
				approve: vi
					.fn()
					.mockResolvedValueOnce(conflictResponse(candidate))
					.mockRejectedValueOnce(new Error('reconcile boom')),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			await vm.approve(group, series, series.rows[0])
			await vm.adoptCandidate()

			expect(vm.conflictView).not.toBeNull()
			expect(vm.conflictError).toBe('Reconciliation failed. Try again.')
			expect(vm.groups).toHaveLength(1)
		})
	})

	describe('reject', () => {
		it('requires a reason before calling reject', async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([resolvedConcert()]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			vm.startReject(row)
			row.rejectReason = '   '
			await vm.confirmReject(group, series, row)

			expect(client.reject).not.toHaveBeenCalled()
			expect(row.actionError).toContain('reason is required')
			expect(series.rows).toHaveLength(1)
		})

		// @spec components/infrastructure/admin/web/route/approval-queue "Reviewer rejects an item with a reason"
		it('calls reject(id, reason) and removes the row, pruning empty groups', async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([resolvedConcert()]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			vm.startReject(row)
			row.rejectReason = 'wrong date'
			await vm.confirmReject(group, series, row)

			expect(client.reject).toHaveBeenCalledWith('candidate-1', 'wrong date')
			expect(vm.groups).toHaveLength(0)
		})
	})

	describe('toRow openTime mapping', () => {
		it('formats openTime via formatTimeOfDay when present', async () => {
			const openTs = { hours: 18, minutes: 0 }
			const concert = makeConcert({
				concertCandidateId: 'candidate-1',
				artist: 'The Resolved Band',
				title: 'Summer Tour',
				year: 2026,
				month: 7,
				day: 4,
				placeId: 'ChIJNipponBudokan',
				adminArea: 'JP-13',
				openTime: openTs,
			})
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([concert]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const row = vm.groups[0].series[0].rows[0]
			// formatTimeOfDay uses toLocaleTimeString; in test env it produces HH:MM.
			expect(row.openTime).not.toBe('—')
			expect(row.openTime).toBe('18:00')
		})

		it('returns dash placeholder when openTime is absent', async () => {
			const concert = resolvedConcert()
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([concert]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const row = vm.groups[0].series[0].rows[0]
			expect(row.openTime).toBe('—')
		})
	})

	describe('toConflictView candidateOpenTime mapping', () => {
		it('sets candidateOpenTime from row.openTime when present', async () => {
			const openTs = { hours: 18, minutes: 0 }
			const concert = makeConcert({
				concertCandidateId: 'candidate-1',
				artist: 'The Resolved Band',
				title: 'Summer Tour',
				year: 2026,
				month: 7,
				day: 4,
				placeId: 'ChIJNipponBudokan',
				adminArea: 'JP-13',
				openTime: openTs,
			})
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([concert]),
				approve: vi.fn().mockResolvedValue(conflictResponse(concert)),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			await vm.approve(group, series, row)

			expect(vm.conflictView).not.toBeNull()
			expect(vm.conflictView!.candidateOpenTime).toBe(row.openTime)
			expect(vm.conflictView!.candidateOpenTime).not.toBe('—')
		})

		// @spec components/infrastructure/admin/web/route/approval-queue "Conflict dialog shows open time for both the candidate and the existing event"
		it('sets candidateOpenTime to dash placeholder when openTime is absent', async () => {
			const concert = resolvedConcert()
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([concert]),
				approve: vi.fn().mockResolvedValue(conflictResponse(concert)),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			await vm.approve(group, series, row)

			expect(vm.conflictView).not.toBeNull()
			expect(vm.conflictView!.candidateOpenTime).toBe('—')
			// The existing event in conflictResponse() has no open time either.
			expect(vm.conflictView!.existingOpenTime).toBe('—')
		})
	})

	describe('area and time zone', () => {
		const SPEC = 'components/infrastructure/admin/web/route/approval-queue'

		/** A row whose concert has no admin area and no time zone. */
		function unknownVenue(): ConcertCandidate {
			return makeConcert({
				concertCandidateId: 'candidate-unknown',
				artist: 'Touring Act',
				title: 'World Tour',
				year: 2026,
				month: 10,
				day: 1,
				adminArea: null,
				timeZone: null,
			})
		}

		async function firstRow(
			concert: ConcertCandidate,
			client = createMockClient({ list: vi.fn().mockResolvedValue([concert]) }),
		) {
			const fixture = await build(client)
			const vm = routeOf(fixture)
			const group = vm.groups[0]
			const series = group.series[0]
			return { fixture, vm, client, group, series, row: series.rows[0] }
		}

		async function enterArea(
			vm: InstanceType<typeof ApprovalQueueRoute>,
			row: { areaInput: string },
			text: string,
		) {
			row.areaInput = text
			await vm.areaChanged(row as never)
		}

		it(`@spec ${SPEC} "Area and time zone unknown"`, async () => {
			const { fixture, row } = await firstRow(unknownVenue())

			const text = fixture.appHost.textContent ?? ''
			expect(text).toContain('地域不明')
			expect(text).toContain('タイムゾーン不明')
			expect(
				fixture.appHost.querySelector('input[aria-label="Area"]'),
			).not.toBeNull()
			expect(
				fixture.appHost.querySelector('select[aria-label="Time zone"]'),
			).not.toBeNull()
			expect(row.approvable).toBe(false)
			const approve = fixture.appHost.querySelector<HTMLButtonElement>(
				'button[data-variant="approve"]',
			)
			expect(approve?.disabled).toBe(true)
		})

		it(`@spec ${SPEC} "Area given by name"`, async () => {
			const { vm, row } = await firstRow(unknownVenue())

			await enterArea(vm, row, 'Texas')

			expect(row.areaState).toBe('resolved')
			expect(row.zoneOptions).toEqual([
				{ value: 'America/Chicago', label: 'シカゴ' },
				{ value: 'America/Denver', label: 'デンバー' },
			])
			expect(row.zoneChoice).toBe('')
			expect(row.approvable).toBe(false)
		})

		it(`@spec ${SPEC} "Area and time zone given"`, async () => {
			const { vm, client, group, series, row } = await firstRow(unknownVenue())

			await enterArea(vm, row, 'Texas')
			vm.zoneChanged(row, 'America/Chicago')
			expect(row.approvable).toBe(true)
			await vm.approve(group, series, row)

			expect(client.approve).toHaveBeenCalledWith(
				'candidate-unknown',
				Resolution.UNSPECIFIED,
				{
					adminArea: 'Texas',
					timeZone: 'America/Chicago',
				},
			)
			expect(vm.groups).toHaveLength(0)
		})

		it(`@spec ${SPEC} "Area with a time zone of its own"`, async () => {
			const { vm, row } = await firstRow(unknownVenue())

			await enterArea(vm, row, '東京都')

			expect(row.zoneChoice).toBe('Asia/Tokyo')
			expect(row.zoneOptions).toEqual([{ value: 'Asia/Tokyo', label: '日本' }])
			expect(row.approvable).toBe(true)
		})

		it(`@spec ${SPEC} "Discovered area until one is entered"`, async () => {
			const { row } = await firstRow(
				makeConcert({
					concertCandidateId: 'candidate-tx',
					artist: 'Touring Act',
					title: 'World Tour',
					year: 2026,
					month: 10,
					day: 2,
					adminArea: 'US-TX',
					timeZone: null,
				}),
			)

			await vi.waitFor(() =>
				expect(row.zoneOptions.map((o) => o.value)).toEqual([
					'America/Chicago',
					'America/Denver',
				]),
			)
			expect(row.zoneChoice).toBe('')
			expect(row.approvable).toBe(false)
		})

		it(`@spec ${SPEC} "Area present but wrong"`, async () => {
			const { vm, client, group, series, row } = await firstRow(
				resolvedConcert(),
			)
			expect(row.adminArea).toBe('JP-13')

			await enterArea(vm, row, 'JP-27')
			await vm.approve(group, series, row)

			expect(client.approve).toHaveBeenCalledWith(
				'candidate-1',
				Resolution.UNSPECIFIED,
				{
					adminArea: 'JP-27',
					timeZone: 'Asia/Tokyo',
				},
			)
		})

		it(`@spec ${SPEC} "Area not found"`, async () => {
			const { fixture, vm, row } = await firstRow(unknownVenue())

			await enterArea(vm, row, 'JP-99')

			expect(row.areaState).toBe('notFound')
			expect(row.zoneOptions).toEqual([])
			expect(row.approvable).toBe(false)
			await vi.waitFor(() =>
				expect(fixture.appHost.textContent).toContain('地域が見つかりません'),
			)
		})

		it('does not let a row with an unresolved entry be approved even when it has its own area', async () => {
			const { vm, row } = await firstRow(resolvedConcert())

			await enterArea(vm, row, 'JP-99')

			expect(row.approvable).toBe(false)
		})

		it(`@spec ${SPEC} "Approval refused"`, async () => {
			const client = createMockClient({
				list: vi.fn().mockResolvedValue([resolvedConcert()]),
				approve: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('bad zone', Code.InvalidArgument),
					),
			})
			const { vm, group, series, row } = await firstRow(
				resolvedConcert(),
				client,
			)

			await vm.approve(group, series, row)

			expect(series.rows).toContain(row)
			expect(row.actionError).toBe(
				'地域またはタイムゾーンが受け付けられませんでした',
			)
		})

		it("needs a zone of the entered area's country even when the row has a zone of its own", async () => {
			const { vm, row } = await firstRow(resolvedConcert())
			expect(row.approvable).toBe(true)

			await enterArea(vm, row, 'Texas')

			// Asia/Tokyo is not a US zone: the select empties and Approve waits for a choice.
			expect(row.zoneChoice).toBe('')
			expect(row.approvable).toBe(false)
			vm.zoneChanged(row, 'America/Chicago')
			expect(row.approvable).toBe(true)
		})

		it('drops the zones of an area replaced while they were read', async () => {
			let releaseUs: (v: unknown) => void = () => {}
			const areaClient = createMockAreaClient()
			areaClient.listByCountry.mockImplementation(async (code: string) =>
				code === 'US'
					? new Promise((resolve) => {
							releaseUs = () => resolve(countries.US)
						})
					: countries[code],
			)
			const fixture = await build(
				createMockClient({ list: vi.fn().mockResolvedValue([unknownVenue()]) }),
				areaClient,
			)
			const vm = routeOf(fixture)
			const row = vm.groups[0].series[0].rows[0]

			row.areaInput = 'Texas'
			const slow = vm.areaChanged(row)
			await vi.waitFor(() =>
				expect(areaClient.listByCountry).toHaveBeenCalledWith('US'),
			)
			await enterArea(vm, row, '東京都')
			releaseUs(undefined)
			await slow

			expect(row.zoneOptions.map((o) => o.value)).toEqual(['Asia/Tokyo'])
			expect(row.zoneChoice).toBe('Asia/Tokyo')
		})
	})
})
