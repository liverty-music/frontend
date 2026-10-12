import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	type Event,
	EventSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import {
	PublishState,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthoredSeries } from '../../../organizer/services/series-client'
import { createTestContainer } from '../../helpers/create-container'
import { authoredSeries } from '../authored-series'

// Replace the RPC client module with a fresh interface token so the route binds
// to the test double instead of building a real Connect transport.
const ISeriesClient = DI.createInterface('ISeriesClient')

vi.mock('../../../organizer/services/series-client', () => ({
	ISeriesClient,
}))

const { ConcertsRoute } = await import(
	'../../../organizer/concerts/concerts-route'
)

interface MockClient {
	list: ReturnType<typeof vi.fn>
	publish: ReturnType<typeof vi.fn>
	cancel: ReturnType<typeof vi.fn>
}

/**
 * Builds an event with an id, a calendar date and its own publish state. The
 * month/day increment with `dayOffset` so multi-event rows get
 * distinguishable date labels. Without a state the event takes its concert's
 * (see {@link makeConcert}).
 */
function makeEvent(
	eventId: string,
	dayOffset = 0,
	publishState = PublishState.UNSPECIFIED,
): Event {
	return create(EventSchema, {
		id: { value: eventId },
		localDate: {
			value: { year: 2026, month: 9, day: 10 + dayOffset },
		},
		publishState,
	})
}

/**
 * Builds an authored concert. `publishState` is the Series' derived state; an
 * event without its own state takes it, and a concert given no events gets one
 * event in that state, as the server never returns a Series without events.
 */
function makeConcert(
	id: string,
	title: string,
	publishState: PublishState,
	visibility: Visibility,
	events: Event[] = [makeEvent(`${id}-e`)],
): AuthoredSeries {
	for (const event of events) {
		if (event.publishState === PublishState.UNSPECIFIED) {
			event.publishState = publishState
		}
	}
	return authoredSeries({
		series: {
			id: { value: id },
			title: { value: title },
			type: SeriesType.SINGLE,
			visibility,
			publishState,
		},
		events,
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
		Registration.instance(ISeriesClient, client),
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

	it('exposes a lottery entry point per event on a published concert', async () => {
		// @spec components/infrastructure/organizer/web/route/concerts "Organizer reaches lottery configuration from a published event"
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeConcert(
						's1',
						'Published Show',
						PublishState.PUBLISHED,
						Visibility.PUBLIC,
						[makeEvent('e1')],
					),
				]),
		})
		const vm = build(client)
		await vm.attached()

		expect(vm.rows[0].lotteryEvents).toEqual([
			{ eventId: 'e1', label: 'Configure lottery' },
		])
	})

	it('labels each lottery entry point with its date when a series has several events', async () => {
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeConcert('s1', 'Tour', PublishState.PUBLISHED, Visibility.PUBLIC, [
						makeEvent('e1', 0),
						makeEvent('e2', 1),
					]),
				]),
		})
		const vm = build(client)
		await vm.attached()

		expect(vm.rows[0].lotteryEvents).toEqual([
			{ eventId: 'e1', label: 'Configure lottery · 2026-09-10' },
			{ eventId: 'e2', label: 'Configure lottery · 2026-09-11' },
		])
	})

	it('offers no lottery entry point on a draft concert', async () => {
		// @spec components/infrastructure/organizer/web/route/concerts "No lottery entry point for a draft event"
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeConcert(
						's1',
						'Draft Show',
						PublishState.DRAFT,
						Visibility.PUBLIC,
						[makeEvent('e1')],
					),
				]),
		})
		const vm = build(client)
		await vm.attached()

		expect(vm.rows[0].lotteryEvents).toEqual([])
	})

	it('reaches the scanners of every event of a concert that is not cancelled', async () => {
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeConcert('s1', 'Tour', PublishState.PUBLISHED, Visibility.PUBLIC, [
						makeEvent('e1', 0),
						makeEvent('e2', 1),
					]),
					makeConcert('s2', 'Draft', PublishState.DRAFT, Visibility.PUBLIC, [
						makeEvent('e3'),
					]),
					makeConcert('s3', 'Gone', PublishState.CANCELLED, Visibility.PUBLIC, [
						makeEvent('e4'),
					]),
				]),
		})
		const vm = build(client)
		await vm.attached()

		expect(vm.rows[0].scannerEvents).toEqual([
			{ eventId: 'e1', label: 'Scanners · 2026-09-10' },
			{ eventId: 'e2', label: 'Scanners · 2026-09-11' },
		])
		// A draft reaches the screen, which says to publish first.
		expect(vm.rows[1].scannerEvents).toEqual([
			{ eventId: 'e3', label: 'Scanners' },
		])
		expect(vm.rows[2].scannerEvents).toEqual([])
	})

	it('reaches the first-come sale editor from every event of a concert that is not cancelled', async () => {
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeConcert('s1', 'Tour', PublishState.PUBLISHED, Visibility.PUBLIC, [
						makeEvent('e1', 0),
						makeEvent('e2', 1),
					]),
					makeConcert('s2', 'Draft', PublishState.DRAFT, Visibility.PUBLIC, [
						makeEvent('e3'),
					]),
					makeConcert('s3', 'Gone', PublishState.CANCELLED, Visibility.PUBLIC, [
						makeEvent('e4'),
					]),
				]),
		})
		const vm = build(client)
		await vm.attached()

		expect(vm.rows[0].ticketSaleEvents).toEqual([
			{ eventId: 'e1', label: 'First-come sale · 2026-09-10' },
			{ eventId: 'e2', label: 'First-come sale · 2026-09-11' },
		])
		// A draft reaches the editor, which says to publish first.
		expect(vm.rows[1].ticketSaleEvents).toEqual([
			{ eventId: 'e3', label: 'First-come sale' },
		])
		expect(vm.rows[2].ticketSaleEvents).toEqual([])
	})

	it('offers Publish on a published tour with a new draft date, and Publish publishes it', async () => {
		// @spec components/infrastructure/organizer/web/route/concerts "Published tour with a new date"
		const tour = makeConcert(
			's1',
			'Tour',
			PublishState.PUBLISHED,
			Visibility.PUBLIC,
			[
				makeEvent('e1', 0, PublishState.PUBLISHED),
				makeEvent('e2', 1, PublishState.DRAFT),
			],
		)
		const published = makeConcert(
			's1',
			'Tour',
			PublishState.PUBLISHED,
			Visibility.PUBLIC,
			[
				makeEvent('e1', 0, PublishState.PUBLISHED),
				makeEvent('e2', 1, PublishState.PUBLISHED),
			],
		)
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValueOnce([tour])
				.mockResolvedValueOnce([published]),
		})
		const vm = build(client)
		await vm.attached()

		expect(vm.rows[0].publishLabel).toBe('Published')
		expect(vm.rows[0].canPublish).toBe(true)
		expect(vm.rows[0].canCancel).toBe(true)

		await vm.publish(vm.rows[0])

		expect(client.publish).toHaveBeenCalledWith('s1')
		expect(vm.rows[0].canPublish).toBe(false)
	})

	it('offers no Publish once every event is published or cancelled', async () => {
		// @spec components/infrastructure/organizer/web/route/concerts "Nothing left to publish"
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeConcert('s1', 'Tour', PublishState.PUBLISHED, Visibility.PUBLIC, [
						makeEvent('e1', 0, PublishState.PUBLISHED),
						makeEvent('e2', 1, PublishState.CANCELLED),
					]),
					makeConcert('s2', 'Gone', PublishState.CANCELLED, Visibility.PUBLIC, [
						makeEvent('e3', 0, PublishState.CANCELLED),
					]),
				]),
		})
		const vm = build(client)
		await vm.attached()

		expect(vm.rows[0].canPublish).toBe(false)
		// A published date is left to cancel.
		expect(vm.rows[0].canCancel).toBe(true)
		expect(vm.rows[1].canPublish).toBe(false)
		expect(vm.rows[1].canCancel).toBe(false)
		expect(vm.rows[1].canEdit).toBe(false)
	})

	it('offers Cancel while a cancelled concert still has a draft date', async () => {
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeConcert('s1', 'Tour', PublishState.CANCELLED, Visibility.PUBLIC, [
						makeEvent('e1', 0, PublishState.CANCELLED),
						makeEvent('e2', 1, PublishState.DRAFT),
					]),
				]),
		})
		const vm = build(client)
		await vm.attached()

		expect(vm.rows[0].publishLabel).toBe('Cancelled')
		expect(vm.rows[0].canPublish).toBe(true)
		expect(vm.rows[0].canCancel).toBe(true)
		expect(vm.rows[0].canEdit).toBe(true)
	})

	it("gates each entry point on the event's own state, not the concert's", async () => {
		// @spec components/infrastructure/organizer/web/route/concerts "Organizer reaches lottery configuration from a published event"
		// @spec components/infrastructure/organizer/web/route/concerts "No lottery entry point for a draft event"
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeConcert('s1', 'Tour', PublishState.PUBLISHED, Visibility.PUBLIC, [
						makeEvent('e1', 0, PublishState.PUBLISHED),
						makeEvent('e2', 1, PublishState.DRAFT),
						makeEvent('e3', 2, PublishState.CANCELLED),
					]),
				]),
		})
		const vm = build(client)
		await vm.attached()

		expect(vm.rows[0].lotteryEvents).toEqual([
			{ eventId: 'e1', label: 'Configure lottery · 2026-09-10' },
		])
		// The draft date reaches the screens, which say to publish first; the
		// cancelled date reaches neither.
		expect(vm.rows[0].ticketSaleEvents.map((e) => e.eventId)).toEqual([
			'e1',
			'e2',
		])
		expect(vm.rows[0].scannerEvents.map((e) => e.eventId)).toEqual(['e1', 'e2'])
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
		expect(vm.confirmingCancelId).toBe('s1')
		await vm.cancel(vm.rows[0])

		expect(client.cancel).toHaveBeenCalledWith('s1')
		expect(vm.rows[0].publishLabel).toBe('Cancelled')
	})
})

// Renders the real template: the confirmation must appear when Cancel is
// clicked. It is bound to `confirmingCancelId` directly, because a binding to a
// method call is not re-evaluated when the state the method reads changes.
describe('ConcertsRoute template', () => {
	it('shows the confirmation when Cancel is clicked and hides it on Keep it', async () => {
		const client = createMockClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeConcert('s1', 'Show', PublishState.PUBLISHED, Visibility.PUBLIC),
				]),
		})
		const fixture = await createFixture(
			'<concerts-route></concerts-route>',
			class {},
			[ConcertsRoute, Registration.instance(ISeriesClient, client)],
		).started
		await tasksSettled()
		const host = fixture.appHost
		const button = (label: string) =>
			[...host.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === label,
			)

		expect(host.querySelector('[aria-label="Confirm cancellation"]')).toBeNull()

		button('Cancel')?.click()
		await tasksSettled()

		expect(
			host.querySelector('[aria-label="Confirm cancellation"]'),
		).not.toBeNull()
		expect(button('Cancel')).toBeUndefined()

		button('Keep it')?.click()
		await tasksSettled()

		expect(host.querySelector('[aria-label="Confirm cancellation"]')).toBeNull()
		expect(button('Cancel')).toBeDefined()
		await fixture.stop(true)
	})
})
