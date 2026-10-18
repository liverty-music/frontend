import { createFixture } from '@aurelia/testing'
import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { SeriesSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConcert } from '../../../shared/lib/concert/resolve-concert'

// The route resolves IConcertClient. Replace the real module (which would build
// a Connect transport over the generated client) with a fresh interface token +
// a no-op class so the fixture binds to the test double.
const IConcertClient = DI.createInterface('IConcertClient')

vi.mock('../../../admin/services/concert-client', () => ({
	IConcertClient,
}))

const { ApprovedConcertsRoute } = await import(
	'../../../admin/approved-concerts/approved-concerts-route'
)

interface MockClient {
	list: ReturnType<typeof vi.fn>
	delete: ReturnType<typeof vi.fn>
}

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
	return {
		list: vi.fn().mockResolvedValue([]),
		delete: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

function concert(opts: {
	eventId: string
	artist: string
	seriesId: string
	seriesTitle: string
	venue: string
	day: number
	startHourUtc?: number
	openHourUtc?: number
}): ResolvedConcert {
	const event = create(EventSchema, {
		id: { value: opts.eventId },
		seriesId: { value: opts.seriesId },
		localDate: {
			value: { year: 2026, month: 7, day: opts.day },
		},
		venue: { name: { value: opts.venue } },
		...(opts.startHourUtc !== undefined
			? {
					startTime: {
						value: timestampFromDate(
							new Date(Date.UTC(2026, 6, opts.day, opts.startHourUtc)),
						),
					},
				}
			: {}),
		...(opts.openHourUtc !== undefined
			? {
					openTime: {
						value: timestampFromDate(
							new Date(Date.UTC(2026, 6, opts.day, opts.openHourUtc)),
						),
					},
				}
			: {}),
	})
	return {
		event,
		series: create(SeriesSchema, {
			id: { value: opts.seriesId },
			title: { value: opts.seriesTitle },
		}),
		artists: [create(ArtistSchema, { name: { value: opts.artist } })],
	}
}

const ERROR_MESSAGES_SPEC =
	'components/infrastructure/admin/web/global/error-messages'

async function build(client: MockClient) {
	const fixture = createFixture
		.html(
			'<approved-concerts-route component.ref="route"></approved-concerts-route>',
		)
		.deps(ApprovedConcertsRoute, Registration.instance(IConcertClient, client))
		.build()
	await fixture.started
	return fixture
}

function routeOf(
	fixture: Awaited<ReturnType<typeof build>>,
): InstanceType<typeof ApprovedConcertsRoute> {
	return (
		fixture.component as {
			route: InstanceType<typeof ApprovedConcertsRoute>
		}
	).route
}

describe('ApprovedConcertsRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('groups concerts by artist then series, with a date range per series', async () => {
		const client = createMockClient({
			list: vi.fn().mockResolvedValue([
				// Band A — Tour S1, two dates.
				concert({
					eventId: 'e1',
					artist: 'Band A',
					seriesId: 's1',
					seriesTitle: 'A Spring Tour',
					venue: 'Hall 1',
					day: 4,
				}),
				concert({
					eventId: 'e2',
					artist: 'Band A',
					seriesId: 's1',
					seriesTitle: 'A Spring Tour',
					venue: 'Hall 2',
					day: 6,
				}),
				// Band A — a second series, one date.
				concert({
					eventId: 'e3',
					artist: 'Band A',
					seriesId: 's2',
					seriesTitle: 'A Summer Show',
					venue: 'Hall 3',
					day: 9,
				}),
				// Band B — its own series.
				concert({
					eventId: 'e4',
					artist: 'Band B',
					seriesId: 's3',
					seriesTitle: 'B Live',
					venue: 'Hall 4',
					day: 5,
				}),
			]),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)

		expect(vm.groups).toHaveLength(2)
		const bandA = vm.groups.find((g) => g.artistName === 'Band A')
		expect(bandA?.series).toHaveLength(2)
		const tour = bandA?.series.find((s) => s.seriesTitle === 'A Spring Tour')
		expect(tour?.rows).toHaveLength(2)
		expect(tour?.dateRange).toBe('2026-07-04 – 2026-07-06')
		const summer = bandA?.series.find((s) => s.seriesTitle === 'A Summer Show')
		expect(summer?.dateRange).toBe('2026-07-09')

		const text = fixture.appHost.textContent ?? ''
		expect(text).toContain('Band A')
		expect(text).toContain('Band B')
		expect(text).toContain('A Spring Tour')
	})

	it('shows start and open times when present, and a dash when absent', async () => {
		const client = createMockClient({
			list: vi.fn().mockResolvedValue([
				concert({
					eventId: 'e1',
					artist: 'Band A',
					seriesId: 's1',
					seriesTitle: 'A Tour',
					venue: 'Hall',
					day: 4,
					startHourUtc: 9,
					openHourUtc: 8,
				}),
				concert({
					eventId: 'e2',
					artist: 'Band A',
					seriesId: 's1',
					seriesTitle: 'A Tour',
					venue: 'Hall',
					day: 5,
				}),
			]),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)
		const rows = vm.groups[0].series[0].rows

		expect(rows[0].startTime).not.toBe('—')
		expect(rows[0].openTime).not.toBe('—')
		expect(rows[1].startTime).toBe('—')
		expect(rows[1].openTime).toBe('—')
	})

	it('renders the empty state when no concerts are published', async () => {
		const client = createMockClient({ list: vi.fn().mockResolvedValue([]) })
		const fixture = await build(client)

		expect(fixture.appHost.textContent).toContain('No published concerts')
	})

	it(`@spec ${ERROR_MESSAGES_SPEC} "Failure without an error code"`, async () => {
		// A fetch that never reaches the server rejects with a TypeError.
		const client = createMockClient({
			list: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)

		expect(vm.phase).toBe('error')
		expect(fixture.appHost.textContent).toContain(
			'Could not load published concerts',
		)
		expect(fixture.appHost.textContent).toContain(
			'Failed to load published concerts.',
		)
		expect(fixture.appHost.textContent).not.toContain('Failed to fetch')
	})

	it('delete is gated behind the confirmation dialog', async () => {
		const client = createMockClient({
			list: vi.fn().mockResolvedValue([
				concert({
					eventId: 'e1',
					artist: 'Band A',
					seriesId: 's1',
					seriesTitle: 'A Show',
					venue: 'Hall',
					day: 4,
				}),
			]),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)
		const group = vm.groups[0]
		const series = group.series[0]
		const row = series.rows[0]

		// Requesting delete prepares the dialog but does NOT delete yet.
		vm.requestDelete(group, series, row)
		expect(vm.pendingLabel).toContain('A Show')
		expect(client.delete).not.toHaveBeenCalled()

		// Confirming issues delete(eventId) and drops the row + emptied series + artist.
		await vm.confirmDelete()
		expect(client.delete).toHaveBeenCalledWith('e1')
		expect(vm.groups).toHaveLength(0)
	})

	it(`@spec ${ERROR_MESSAGES_SPEC} "Code without copy of its own"`, async () => {
		const client = createMockClient({
			list: vi.fn().mockResolvedValue([
				concert({
					eventId: 'e1',
					artist: 'Band A',
					seriesId: 's1',
					seriesTitle: 'A Show',
					venue: 'Hall',
					day: 4,
				}),
			]),
			delete: vi
				.fn()
				.mockRejectedValue(
					new ConnectError(
						'event_id: value must be a valid UUID',
						Code.InvalidArgument,
					),
				),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)
		const group = vm.groups[0]
		const series = group.series[0]
		const row = series.rows[0]

		vm.requestDelete(group, series, row)
		await vm.confirmDelete()
		await fixture.tasksSettled

		expect(row.actionError).toBe('Delete failed. Try again.')
		expect(fixture.appHost.textContent).toContain('Delete failed. Try again.')
		expect(fixture.appHost.textContent).not.toContain('valid UUID')
		expect(row.busy).toBe(false)
		expect(series.rows).toHaveLength(1)
		expect(vm.groups).toHaveLength(1)
	})
})
