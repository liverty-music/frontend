import { createFixture } from '@aurelia/testing'
import { Date as GoogleDate } from '@buf/googleapis_googleapis.bufbuild_es/google/type/date_pb.js'
import {
	Artist,
	ArtistName,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import {
	ListedVenueName,
	LocalDate,
	Title,
	Url,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/entity_pb.js'
import { StagedConcertId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/staged_concert_pb.js'
import {
	AdminArea,
	VenueName,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/venue_pb.js'
import {
	PendingConcert,
	ResolvedVenue,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/v1/concert_service_pb.js'
import { Timestamp } from '@bufbuild/protobuf'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The route resolves IConcertClient. Replace the real module (which would build
// a Connect transport over the generated client) with a fresh interface token +
// a no-op class so the fixture binds to the test double.
const IConcertClient = DI.createInterface('IConcertClient')

vi.mock('../../../admin/services/concert-client', () => ({
	IConcertClient,
}))

const { ApprovalQueueRoute } = await import(
	'../../../admin/approval-queue/approval-queue-route'
)

interface MockClient {
	listPending: ReturnType<typeof vi.fn>
	approve: ReturnType<typeof vi.fn>
	reject: ReturnType<typeof vi.fn>
}

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
	return {
		listPending: vi.fn().mockResolvedValue([]),
		approve: vi.fn().mockResolvedValue(undefined),
		reject: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

function makeConcert(opts: {
	stagedId: string
	artist: string
	title: string
	year: number
	month: number
	day: number
	resolvedVenue?: { name: string; adminArea: string }
	sourceUrl?: string
}): PendingConcert {
	return new PendingConcert({
		stagedId: new StagedConcertId({ value: opts.stagedId }),
		performer: new Artist({
			name: new ArtistName({ value: opts.artist }),
		}),
		title: new Title({ value: opts.title }),
		localDate: new LocalDate({
			value: new GoogleDate({
				year: opts.year,
				month: opts.month,
				day: opts.day,
			}),
		}),
		listedVenueName: new ListedVenueName({ value: 'listed venue' }),
		resolvedVenue: opts.resolvedVenue
			? new ResolvedVenue({
					name: new VenueName({ value: opts.resolvedVenue.name }),
					adminArea: new AdminArea({ value: opts.resolvedVenue.adminArea }),
				})
			: undefined,
		sourceUrl: opts.sourceUrl ? new Url({ value: opts.sourceUrl }) : undefined,
		discoveredTime: Timestamp.fromDate(new Date('2026-06-01T12:00:00Z')),
	})
}

function resolvedConcert(): PendingConcert {
	return makeConcert({
		stagedId: 'staged-1',
		artist: 'The Resolved Band',
		title: 'Summer Tour',
		year: 2026,
		month: 7,
		day: 4,
		resolvedVenue: { name: 'Nippon Budokan', adminArea: 'JP-13' },
		sourceUrl: 'https://example.com/show/1',
	})
}

function unresolvedConcert(): PendingConcert {
	return makeConcert({
		stagedId: 'staged-2',
		artist: 'No Venue Act',
		title: 'Mystery Gig',
		year: 2026,
		month: 8,
		day: 9,
		sourceUrl: 'https://example.com/show/2',
	})
}

async function build(client: MockClient) {
	const fixture = createFixture
		.html('<approval-queue-route component.ref="route"></approval-queue-route>')
		.deps(ApprovalQueueRoute, Registration.instance(IConcertClient, client))
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
		it('groups concerts by artist and then by title', async () => {
			const client = createMockClient({
				listPending: vi.fn().mockResolvedValue([
					makeConcert({
						stagedId: 's1',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 1,
						resolvedVenue: { name: 'Venue 1', adminArea: 'JP-13' },
					}),
					makeConcert({
						stagedId: 's2',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 2,
						resolvedVenue: { name: 'Venue 2', adminArea: 'JP-14' },
					}),
					makeConcert({
						stagedId: 's3',
						artist: 'Band A',
						title: 'Tour Y',
						year: 2026,
						month: 8,
						day: 1,
					}),
					makeConcert({
						stagedId: 's4',
						artist: 'Band B',
						title: 'Festival',
						year: 2026,
						month: 9,
						day: 1,
						resolvedVenue: { name: 'Venue 3', adminArea: 'JP-27' },
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
				listPending: vi.fn().mockResolvedValue([
					makeConcert({
						stagedId: 's1',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 1,
						resolvedVenue: { name: 'Venue 1', adminArea: 'JP-13' },
					}),
					makeConcert({
						stagedId: 's2',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 2,
					}),
					makeConcert({
						stagedId: 's3',
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
		it('renders reviewable fields for resolved and unresolved rows', async () => {
			const client = createMockClient({
				listPending: vi
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
			expect(text).toContain('Nippon Budokan')
			expect(text).toContain('JP-13')
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
				listPending: vi.fn().mockResolvedValue([unresolvedConcert()]),
			})
			const fixture = await build(client)

			expect(fixture.appHost.textContent).toContain('⚠')
			expect(fixture.appHost.textContent).toContain('unresolved')
		})

		it('does not render a source link for a javascript: URL (XSS guard)', async () => {
			const malicious = makeConcert({
				stagedId: 'staged-xss',
				artist: 'Sketchy Act',
				title: 'Suspicious Show',
				year: 2026,
				month: 9,
				day: 1,
				// AI-sourced URL carrying a script payload — must be neutralised.
				sourceUrl: 'javascript:alert(document.cookie)',
			})
			const client = createMockClient({
				listPending: vi.fn().mockResolvedValue([malicious]),
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
				listPending: vi.fn().mockResolvedValue([]),
			})
			const fixture = await build(client)

			expect(fixture.appHost.textContent).toContain(
				'No concerts awaiting review',
			)
		})

		it('shows the error state when the initial list fails', async () => {
			const client = createMockClient({
				listPending: vi.fn().mockRejectedValue(new Error('boom')),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			expect(vm.phase).toBe('error')
			expect(fixture.appHost.textContent).toContain(
				'Could not load the approval queue',
			)
			expect(fixture.appHost.textContent).toContain('boom')
		})
	})

	describe('approve', () => {
		it('calls approve(id) and removes the row, pruning empty series and artist groups', async () => {
			const client = createMockClient({
				listPending: vi.fn().mockResolvedValue([resolvedConcert()]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			expect(series.rows).toHaveLength(1)

			await vm.approve(group, series, row)

			expect(client.approve).toHaveBeenCalledWith('staged-1')
			// Row removed → series pruned → artist group pruned.
			expect(vm.groups).toHaveLength(0)
		})

		it('decrements unresolvedCount when an unresolved row is approved', async () => {
			const client = createMockClient({
				listPending: vi.fn().mockResolvedValue([
					makeConcert({
						stagedId: 's1',
						artist: 'Band A',
						title: 'Tour',
						year: 2026,
						month: 7,
						day: 1,
					}),
					makeConcert({
						stagedId: 's2',
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
				listPending: vi.fn().mockResolvedValue([resolvedConcert()]),
				approve: vi.fn().mockRejectedValue(new Error('approve failed')),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			await vm.approve(group, series, row)

			expect(row.actionError).toContain('approve failed')
			expect(row.busy).toBe(false)
			expect(series.rows).toHaveLength(1)
		})

		it('prunes only the empty series, not the artist group, when another series remains', async () => {
			const client = createMockClient({
				listPending: vi.fn().mockResolvedValue([
					makeConcert({
						stagedId: 's1',
						artist: 'Band A',
						title: 'Tour X',
						year: 2026,
						month: 7,
						day: 1,
						resolvedVenue: { name: 'Venue', adminArea: 'JP-13' },
					}),
					makeConcert({
						stagedId: 's2',
						artist: 'Band A',
						title: 'Tour Y',
						year: 2026,
						month: 8,
						day: 1,
						resolvedVenue: { name: 'Venue', adminArea: 'JP-14' },
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

	describe('reject', () => {
		it('requires a reason before calling reject', async () => {
			const client = createMockClient({
				listPending: vi.fn().mockResolvedValue([resolvedConcert()]),
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

		it('calls reject(id, reason) and removes the row, pruning empty groups', async () => {
			const client = createMockClient({
				listPending: vi.fn().mockResolvedValue([resolvedConcert()]),
			})
			const fixture = await build(client)
			const vm = routeOf(fixture)

			const group = vm.groups[0]
			const series = group.series[0]
			const row = series.rows[0]
			vm.startReject(row)
			row.rejectReason = 'wrong date'
			await vm.confirmReject(group, series, row)

			expect(client.reject).toHaveBeenCalledWith('staged-1', 'wrong date')
			expect(vm.groups).toHaveLength(0)
		})
	})
})
