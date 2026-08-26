import { Title } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/entity_pb.js'
import {
	PublishState,
	Series,
	SeriesId,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { AuthoredConcert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/v1/concert_service_pb.js'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../../helpers/create-container'

// Replace the RPC client module with a fresh interface token so the route binds
// to the test double instead of building a real Connect transport.
const IConcertAuthoringClient = DI.createInterface('IConcertAuthoringClient')

vi.mock('../../../organizer/services/concert-authoring-client', () => ({
	IConcertAuthoringClient,
}))

const { ConcertsRoute } = await import(
	'../../../organizer/concerts/concerts-route'
)

interface MockClient {
	list: ReturnType<typeof vi.fn>
	publish: ReturnType<typeof vi.fn>
	cancel: ReturnType<typeof vi.fn>
}

function makeConcert(
	id: string,
	title: string,
	publishState: PublishState,
	visibility: Visibility,
): AuthoredConcert {
	return new AuthoredConcert({
		series: new Series({
			id: new SeriesId({ value: id }),
			title: new Title({ value: title }),
			type: SeriesType.SINGLE,
			visibility,
			publishState,
		}),
		events: [],
		performers: [],
	})
}

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
	return {
		list: vi.fn().mockResolvedValue([]),
		publish: vi.fn().mockResolvedValue(undefined),
		cancel: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

function build(client: MockClient): InstanceType<typeof ConcertsRoute> {
	const container = createTestContainer(
		Registration.instance(IConcertAuthoringClient, client),
	)
	container.register(ConcertsRoute)
	return container.get(ConcertsRoute)
}

describe('ConcertsRoute', () => {
	beforeEach(() => vi.clearAllMocks())

	it('loads and flattens concerts on attach', async () => {
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeConcert('s1', 'Show One', PublishState.DRAFT, Visibility.PUBLIC),
					makeConcert(
						's2',
						'Show Two',
						PublishState.PUBLISHED,
						Visibility.UNLISTED,
					),
				]),
		})
		const vm = build(client)
		await vm.attached()

		expect(vm.phase).toBe('ready')
		expect(vm.rows).toHaveLength(2)
		expect(vm.rows[0].title).toBe('Show One')
		expect(vm.rows[0].canPublish).toBe(true)
		expect(vm.rows[0].canCancel).toBe(true)
		expect(vm.rows[1].publishLabel).toBe('Published')
		expect(vm.rows[1].visibilityLabel).toBe('Unlisted')
		expect(vm.rows[1].canPublish).toBe(false)
	})

	it('reports the empty state when there are no concerts', async () => {
		const vm = build(createMockClient())
		await vm.attached()
		expect(vm.isEmpty).toBe(true)
	})

	it('surfaces the error state when the list fails', async () => {
		const client = createMockClient({
			list: vi.fn().mockRejectedValue(new Error('boom')),
		})
		const vm = build(client)
		await vm.attached()
		expect(vm.phase).toBe('error')
		expect(vm.loadError).toContain('boom')
	})

	it('publishes a draft and reloads', async () => {
		const draft = makeConcert(
			's1',
			'Show',
			PublishState.DRAFT,
			Visibility.PUBLIC,
		)
		const published = makeConcert(
			's1',
			'Show',
			PublishState.PUBLISHED,
			Visibility.PUBLIC,
		)
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValueOnce([draft])
				.mockResolvedValueOnce([published]),
		})
		const vm = build(client)
		await vm.attached()
		await vm.publish(vm.rows[0])

		expect(client.publish).toHaveBeenCalledWith('s1')
		expect(vm.rows[0].publishLabel).toBe('Published')
	})

	it('shows a per-row error when publish is precondition-failed', async () => {
		const draft = makeConcert(
			's1',
			'Show',
			PublishState.DRAFT,
			Visibility.PUBLIC,
		)
		const client = createMockClient({
			list: vi.fn().mockResolvedValue([draft]),
			publish: vi
				.fn()
				.mockRejectedValue(new ConnectError('nope', Code.FailedPrecondition)),
		})
		const vm = build(client)
		await vm.attached()
		await vm.publish(vm.rows[0])

		expect(vm.rows[0].actionError).toContain('can no longer be published')
		expect(vm.rows[0].busy).toBe(false)
	})

	it('confirms then cancels a concert', async () => {
		const row = makeConcert('s1', 'Show', PublishState.DRAFT, Visibility.PUBLIC)
		const cancelled = makeConcert(
			's1',
			'Show',
			PublishState.CANCELLED,
			Visibility.PUBLIC,
		)
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValueOnce([row])
				.mockResolvedValueOnce([cancelled]),
		})
		const vm = build(client)
		await vm.attached()

		vm.confirmCancel(vm.rows[0])
		expect(vm.isConfirmingCancel(vm.rows[0])).toBe(true)
		await vm.cancel(vm.rows[0])

		expect(client.cancel).toHaveBeenCalledWith('s1')
		expect(vm.rows[0].publishLabel).toBe('Cancelled')
	})
})
