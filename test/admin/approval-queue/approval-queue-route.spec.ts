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
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/v1/concert_moderation_service_pb.js'
import { Timestamp } from '@bufbuild/protobuf'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The route resolves IConcertModerationClient. Replace the real module (which
// would build a Connect transport over the generated client) with a fresh
// interface token + a no-op class so the fixture binds to the test double.
const IConcertModerationClient = DI.createInterface('IConcertModerationClient')

vi.mock('../../../admin/services/concert-moderation-client', () => ({
	IConcertModerationClient,
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

function resolvedConcert(): PendingConcert {
	return new PendingConcert({
		stagedId: new StagedConcertId({ value: 'staged-1' }),
		performer: new Artist({
			name: new ArtistName({ value: 'The Resolved Band' }),
		}),
		title: new Title({ value: 'Summer Tour' }),
		localDate: new LocalDate({
			value: new GoogleDate({ year: 2026, month: 7, day: 4 }),
		}),
		startTime: undefined,
		listedVenueName: new ListedVenueName({ value: 'budokan hall' }),
		resolvedVenue: new ResolvedVenue({
			name: new VenueName({ value: 'Nippon Budokan' }),
			adminArea: new AdminArea({ value: 'JP-13' }),
		}),
		sourceUrl: new Url({ value: 'https://example.com/show/1' }),
		discoveredTime: Timestamp.fromDate(new Date('2026-06-01T12:00:00Z')),
	})
}

function unresolvedConcert(): PendingConcert {
	return new PendingConcert({
		stagedId: new StagedConcertId({ value: 'staged-2' }),
		performer: new Artist({ name: new ArtistName({ value: 'No Venue Act' }) }),
		title: new Title({ value: 'Mystery Gig' }),
		localDate: new LocalDate({
			value: new GoogleDate({ year: 2026, month: 8, day: 9 }),
		}),
		listedVenueName: new ListedVenueName({ value: 'some unknown place' }),
		resolvedVenue: undefined,
		sourceUrl: new Url({ value: 'https://example.com/show/2' }),
		discoveredTime: Timestamp.fromDate(new Date('2026-06-02T12:00:00Z')),
	})
}

async function build(client: MockClient) {
	const fixture = createFixture
		.html('<approval-queue-route component.ref="route"></approval-queue-route>')
		.deps(
			ApprovalQueueRoute,
			Registration.instance(IConcertModerationClient, client),
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

	it('renders reviewable fields for resolved and unresolved rows', async () => {
		const client = createMockClient({
			listPending: vi
				.fn()
				.mockResolvedValue([resolvedConcert(), unresolvedConcert()]),
		})
		const fixture = await build(client)

		const text = fixture.appHost.textContent ?? ''
		// Resolved row: performer, title, local date, listed + resolved venue, area.
		expect(text).toContain('The Resolved Band')
		expect(text).toContain('Summer Tour')
		expect(text).toContain('2026-07-04')
		expect(text).toContain('budokan hall')
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

	it('does not render a source link for a javascript: URL (XSS guard)', async () => {
		const malicious = new PendingConcert({
			stagedId: new StagedConcertId({ value: 'staged-xss' }),
			performer: new Artist({ name: new ArtistName({ value: 'Sketchy Act' }) }),
			title: new Title({ value: 'Suspicious Show' }),
			localDate: new LocalDate({
				value: new GoogleDate({ year: 2026, month: 9, day: 1 }),
			}),
			listedVenueName: new ListedVenueName({ value: 'somewhere' }),
			// AI-sourced URL carrying a script payload — must be neutralised.
			sourceUrl: new Url({ value: 'javascript:alert(document.cookie)' }),
			discoveredTime: Timestamp.fromDate(new Date('2026-06-03T12:00:00Z')),
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

		expect(fixture.appHost.textContent).toContain('No concerts awaiting review')
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

	it('approve calls approve(id) and removes the row', async () => {
		const client = createMockClient({
			listPending: vi.fn().mockResolvedValue([resolvedConcert()]),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)

		expect(vm.rows).toHaveLength(1)
		await vm.approve(vm.rows[0])

		expect(client.approve).toHaveBeenCalledWith('staged-1')
		expect(vm.rows).toHaveLength(0)
	})

	it('reject requires a reason before calling reject', async () => {
		const client = createMockClient({
			listPending: vi.fn().mockResolvedValue([resolvedConcert()]),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)

		const row = vm.rows[0]
		vm.startReject(row)
		row.rejectReason = '   '
		await vm.confirmReject(row)

		expect(client.reject).not.toHaveBeenCalled()
		expect(row.actionError).toContain('reason is required')
		expect(vm.rows).toHaveLength(1)
	})

	it('reject with a reason calls reject(id, reason) and removes the row', async () => {
		const client = createMockClient({
			listPending: vi.fn().mockResolvedValue([resolvedConcert()]),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)

		const row = vm.rows[0]
		vm.startReject(row)
		row.rejectReason = 'wrong date'
		await vm.confirmReject(row)

		expect(client.reject).toHaveBeenCalledWith('staged-1', 'wrong date')
		expect(vm.rows).toHaveLength(0)
	})

	it('surfaces a per-row error and keeps the row when approve fails', async () => {
		const client = createMockClient({
			listPending: vi.fn().mockResolvedValue([resolvedConcert()]),
			approve: vi.fn().mockRejectedValue(new Error('approve failed')),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)

		const row = vm.rows[0]
		await vm.approve(row)

		expect(row.actionError).toContain('approve failed')
		expect(row.busy).toBe(false)
		expect(vm.rows).toHaveLength(1)
	})
})
