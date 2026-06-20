import { createFixture } from '@aurelia/testing'
import { Date as GoogleDate } from '@buf/googleapis_googleapis.bufbuild_es/google/type/date_pb.js'
import {
	Artist,
	ArtistName,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import {
	LocalDate,
	Title,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/entity_pb.js'
import { EventId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { Series } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	Venue,
	VenueName,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/venue_pb.js'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
	title: string
	venue: string
	day: number
}): Concert {
	return new Concert({
		id: new EventId({ value: opts.eventId }),
		series: new Series({ title: new Title({ value: opts.title }) }),
		localDate: new LocalDate({
			value: new GoogleDate({ year: 2026, month: 7, day: opts.day }),
		}),
		venue: new Venue({ name: new VenueName({ value: opts.venue }) }),
		performers: [new Artist({ name: new ArtistName({ value: opts.artist }) })],
	})
}

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

	it('groups concerts by performing artist', async () => {
		const client = createMockClient({
			list: vi.fn().mockResolvedValue([
				concert({
					eventId: 'e1',
					artist: 'Band A',
					title: 'A Spring Tour',
					venue: 'Hall 1',
					day: 4,
				}),
				concert({
					eventId: 'e2',
					artist: 'Band B',
					title: 'B Live',
					venue: 'Hall 2',
					day: 5,
				}),
				concert({
					eventId: 'e3',
					artist: 'Band A',
					title: 'A Summer Show',
					venue: 'Hall 3',
					day: 6,
				}),
			]),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)

		// Two artist groups; Band A holds two concerts, Band B one.
		expect(vm.groups).toHaveLength(2)
		const bandA = vm.groups.find((g) => g.artistName === 'Band A')
		expect(bandA?.rows).toHaveLength(2)
		const text = fixture.appHost.textContent ?? ''
		expect(text).toContain('Band A')
		expect(text).toContain('Band B')
		expect(text).toContain('A Spring Tour')
		expect(text).toContain('2026-07-04')
		expect(text).toContain('Hall 1')
	})

	it('renders the empty state when no concerts are published', async () => {
		const client = createMockClient({ list: vi.fn().mockResolvedValue([]) })
		const fixture = await build(client)

		expect(fixture.appHost.textContent).toContain('No published concerts')
	})

	it('shows the error state when the initial list fails', async () => {
		const client = createMockClient({
			list: vi.fn().mockRejectedValue(new Error('boom')),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)

		expect(vm.phase).toBe('error')
		expect(fixture.appHost.textContent).toContain(
			'Could not load published concerts',
		)
		expect(fixture.appHost.textContent).toContain('boom')
	})

	it('delete is gated behind an explicit confirmation', async () => {
		const client = createMockClient({
			list: vi.fn().mockResolvedValue([
				concert({
					eventId: 'e1',
					artist: 'Band A',
					title: 'A Show',
					venue: 'Hall',
					day: 4,
				}),
			]),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)
		const group = vm.groups[0]
		const row = group.rows[0]

		// Opening the confirmation does NOT issue the delete.
		vm.startDelete(row)
		expect(row.confirming).toBe(true)
		expect(client.delete).not.toHaveBeenCalled()

		// Confirming issues delete(eventId) and removes the row + empty group.
		await vm.confirmDelete(group, row)
		expect(client.delete).toHaveBeenCalledWith('e1')
		expect(vm.groups).toHaveLength(0)
	})

	it('surfaces a per-row error and keeps the row when delete fails', async () => {
		const client = createMockClient({
			list: vi.fn().mockResolvedValue([
				concert({
					eventId: 'e1',
					artist: 'Band A',
					title: 'A Show',
					venue: 'Hall',
					day: 4,
				}),
			]),
			delete: vi.fn().mockRejectedValue(new Error('delete failed')),
		})
		const fixture = await build(client)
		const vm = routeOf(fixture)
		const group = vm.groups[0]
		const row = group.rows[0]

		await vm.confirmDelete(group, row)

		expect(row.actionError).toContain('delete failed')
		expect(row.busy).toBe(false)
		expect(group.rows).toHaveLength(1)
		expect(vm.groups).toHaveLength(1)
	})
})
