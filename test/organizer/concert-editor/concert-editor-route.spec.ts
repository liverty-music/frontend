import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import {
	PublishState,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create, type MessageInitShape } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
	AuthoredSeries,
	SeriesDraftInput,
} from '../../../organizer/services/series-client'
import { authoredSeries } from '../authored-series'

// Replace the RPC client modules with fresh interface tokens so the route
// binds to test doubles instead of building real Connect transports.
const ISeriesClient = DI.createInterface('ISeriesClient')
const ISeriesImageClient = DI.createInterface('ISeriesImageClient')
const IArtistClient = DI.createInterface('IArtistClient')
vi.mock('../../../organizer/services/series-client', () => ({
	ISeriesClient,
}))
vi.mock('../../../organizer/services/series-image-client', () => ({
	ISeriesImageClient,
}))
vi.mock('../../../organizer/services/artist-client', () => ({
	IArtistClient,
}))

const { ConcertEditorRoute, START_TIME_ON_SALE_MESSAGE } = await import(
	'../../../organizer/concert-editor/concert-editor-route'
)

const CAPABILITY =
	'components/infrastructure/organizer/web/route/concert-editor'
const SERIES_ID = 'series-1'
const ARTIST = create(ArtistSchema, {
	id: { value: 'artist-1' },
	name: { value: 'The Band' },
})

/** A local wall-clock instant on 2026-11-20 (the editor works in local time). */
function at(hour: number): Date {
	return new Date(2026, 10, 20, hour, 0)
}

function event(
	id: string,
	publishState: PublishState,
	day = 20,
): MessageInitShape<typeof EventSchema> {
	return {
		id: { value: id },
		publishState,
		localDate: { value: { year: 2026, month: 11, day } },
		listedVenueName: { value: 'Shibuya WWW' },
		venue: { name: { value: 'WWW' } },
		startTime: { value: timestampFromDate(at(19)) },
		openTime: { value: timestampFromDate(at(18)) },
	}
}

function concert(
	events: MessageInitShape<typeof EventSchema>[],
	opts: { publishState?: PublishState; cover?: string } = {},
): AuthoredSeries {
	return authoredSeries({
		series: {
			id: { value: SERIES_ID },
			title: { value: 'Autumn Tour' },
			type: SeriesType.TOUR,
			visibility: Visibility.PUBLIC,
			publishState: opts.publishState ?? PublishState.PUBLISHED,
			...(opts.cover ? { coverImage: { large: { value: opts.cover } } } : {}),
		},
		events,
		performers: [ARTIST],
	})
}

interface Mocks {
	series: {
		list: ReturnType<typeof vi.fn>
		update: ReturnType<typeof vi.fn>
		create: ReturnType<typeof vi.fn>
		setCoverImage: ReturnType<typeof vi.fn>
	}
	images: {
		createUploadUrl: ReturnType<typeof vi.fn>
		uploadToSignedUrl: ReturnType<typeof vi.fn>
	}
}

function mocks(c: AuthoredSeries): Mocks {
	return {
		series: {
			list: vi.fn().mockResolvedValue([c]),
			update: vi.fn().mockResolvedValue(c),
			create: vi.fn(),
			setCoverImage: vi.fn().mockResolvedValue(undefined),
		},
		images: {
			createUploadUrl: vi.fn().mockResolvedValue({
				seriesImageId: 'image-1',
				uploadUrl: 'https://storage.example/upload',
			}),
			uploadToSignedUrl: vi.fn().mockResolvedValue(undefined),
		},
	}
}

async function build(m: Mocks) {
	const fixture = createFixture
		.html('<concert-editor-route component.ref="route"></concert-editor-route>')
		.deps(
			ConcertEditorRoute,
			Registration.instance(ISeriesClient, m.series),
			Registration.instance(ISeriesImageClient, m.images),
			Registration.instance(IArtistClient, {
				list: vi.fn().mockResolvedValue([ARTIST]),
			}),
			Registration.instance(IRouter, { load: vi.fn() }),
		)
		.build()
	await fixture.started
	const route = (
		fixture.component as {
			route: InstanceType<typeof ConcertEditorRoute>
		}
	).route
	route.canLoad({ seriesId: SERIES_ID })
	await route.attached()
	await tasksSettled()
	const host = fixture.appHost
	const eventBlocks = () =>
		Array.from(host.querySelectorAll<HTMLElement>('.editor-event'))
	const input = (block: HTMLElement, type: string) =>
		block.querySelector<HTMLInputElement>(`input[type="${type}"]`)
	const removeButton = (block: HTMLElement) =>
		Array.from(block.querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Remove',
		)
	return { fixture, route, host, eventBlocks, input, removeButton }
}

/** The last draft sent to Update. */
function sentDraft(m: Mocks): SeriesDraftInput {
	return m.series.update.mock.calls.at(-1)?.[1] as SeriesDraftInput
}

describe('ConcertEditorRoute', () => {
	beforeEach(() => vi.clearAllMocks())

	it('fixes the venue and date of a published event and offers no remove control', async () => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Published event's venue is fixed"
		const m = mocks(
			concert([
				event('e1', PublishState.PUBLISHED),
				event('e2', PublishState.DRAFT, 21),
			]),
		)
		const { route, host, eventBlocks, input, removeButton } = await build(m)
		const [published, draft] = eventBlocks()

		expect(published.textContent).toContain('Published')
		expect(input(published, 'text')?.disabled).toBe(true)
		expect(input(published, 'date')?.disabled).toBe(true)
		expect(removeButton(published)).toBeUndefined()
		// Times of a published event stay correctable.
		for (const time of published.querySelectorAll<HTMLInputElement>(
			'input[type="time"]',
		)) {
			expect(time.disabled).toBe(false)
		}

		expect(draft.textContent).toContain('Draft')
		expect(input(draft, 'text')?.disabled).toBe(false)
		expect(input(draft, 'date')?.disabled).toBe(false)
		expect(removeButton(draft)).toBeDefined()

		// The type is fixed after the first publish; performers stay editable.
		expect(host.querySelector<HTMLSelectElement>('select')?.disabled).toBe(true)
		expect(
			host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled,
		).toBe(false)

		// The view model refuses to remove a published event too.
		route.removeEvent(0)
		expect(route.model.events).toHaveLength(2)
	})

	it('shows a cancelled event as 中止 and read-only', async () => {
		const m = mocks(
			concert([
				event('e1', PublishState.PUBLISHED),
				event('e2', PublishState.CANCELLED, 21),
			]),
		)
		const { eventBlocks, removeButton } = await build(m)
		const cancelled = eventBlocks()[1]

		expect(cancelled.textContent).toContain('中止')
		for (const el of cancelled.querySelectorAll('input')) {
			expect(el.disabled).toBe(true)
		}
		expect(removeButton(cancelled)).toBeUndefined()
	})

	it('saves a date added to a published concert as a draft, sending the id of each stored event', async () => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Additional date saved as a draft"
		const before = concert([event('e1', PublishState.PUBLISHED)])
		const after = concert([
			event('e1', PublishState.PUBLISHED),
			{
				...event('e2', PublishState.DRAFT, 27),
				startTime: undefined,
				openTime: undefined,
			},
		])
		const m = mocks(before)
		m.series.update.mockResolvedValue(after)
		const { route, eventBlocks } = await build(m)

		route.addEvent()
		const added = route.model.events[1]
		added.venueName = 'Zepp Osaka'
		added.localDate = '2026-11-27'
		await route.save()
		await tasksSettled()

		expect(route.saveError).toBe('')
		const draft = sentDraft(m)
		expect(draft.events.map((e) => e.eventId)).toEqual(['e1', undefined])
		// The published event goes back as listed, so its venue is unchanged.
		expect(draft.events[0].venueName).toBe('Shibuya WWW')
		expect(draft.type).toBe(SeriesType.TOUR)
		expect(draft.visibility).toBe(Visibility.PUBLIC)

		expect(route.model.events[1].eventId).toBe('e2')
		expect(route.model.events[1].publishState).toBe(PublishState.DRAFT)
		expect(eventBlocks()[1].textContent).toContain('Draft')
	})

	it('says the start time is fixed once tickets are on sale when such a save is refused', async () => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Start time already on sale"
		const m = mocks(concert([event('e1', PublishState.PUBLISHED)]))
		m.series.update.mockRejectedValue(
			new ConnectError('start time is on sale', Code.FailedPrecondition),
		)
		const { route, host } = await build(m)

		route.model.events[0].startTime = '20:00'
		await route.save()
		await tasksSettled()

		expect(route.saveError).toBe(START_TIME_ON_SALE_MESSAGE)
		expect(host.textContent).toContain('fixed once tickets are on sale')
		// The refused edit stays on screen; nothing was reloaded as saved.
		expect(route.model.events[0].startTime).toBe('20:00')
	})

	it('does not blame the start time when a refused save left it unchanged', async () => {
		const m = mocks(concert([event('e1', PublishState.PUBLISHED)]))
		m.series.update.mockRejectedValue(
			new ConnectError('refused', Code.FailedPrecondition),
		)
		const { route } = await build(m)

		route.model.events[0].openTime = '17:30'
		await route.save()

		expect(route.saveError).not.toBe(START_TIME_ON_SALE_MESSAGE)
		expect(route.saveError).toContain('correction was rejected')
	})

	it('keeps the type editable while every event is a draft', async () => {
		const m = mocks(
			concert([event('e1', PublishState.DRAFT)], {
				publishState: PublishState.DRAFT,
			}),
		)
		const { host, eventBlocks, input } = await build(m)

		expect(host.querySelector<HTMLSelectElement>('select')?.disabled).toBe(
			false,
		)
		expect(input(eventBlocks()[0], 'text')?.disabled).toBe(false)
	})

	describe('cover image', () => {
		const PREVIEW = 'blob:preview-1'
		const PROCESSED = 'https://images.example/large.webp'

		beforeEach(() => {
			URL.createObjectURL = vi.fn(() => PREVIEW)
			URL.revokeObjectURL = vi.fn()
		})

		afterEach(() => {
			// jsdom has neither; drop the stubs again.
			Reflect.deleteProperty(URL, 'createObjectURL')
			Reflect.deleteProperty(URL, 'revokeObjectURL')
		})

		async function pick(route: InstanceType<typeof ConcertEditorRoute>) {
			const file = new File(['x'], 'cover.png', { type: 'image/png' })
			const target = { files: [file], value: 'cover.png' }
			await route.onCoverSelected({ target } as unknown as Event)
		}

		it('previews the picked image with a note that it is still processed', async () => {
			// @spec components/infrastructure/organizer/web/route/concert-editor "Image just uploaded"
			const m = mocks(concert([event('e1', PublishState.PUBLISHED)]))
			const { route, host } = await build(m)

			await pick(route)
			await tasksSettled()

			expect(m.series.setCoverImage).toHaveBeenCalledWith(
				SERIES_ID,
				'image-1',
				expect.anything(),
			)
			expect(route.renderedCover).toBe(PREVIEW)
			expect(route.coverProcessing).toBe(true)
			expect(host.textContent).toContain('still being processed')
		})

		it('shows the processed image once it is available, and the note is gone', async () => {
			// @spec components/infrastructure/organizer/web/route/concert-editor "Processed image available"
			const m = mocks(concert([event('e1', PublishState.PUBLISHED)]))
			m.series.update.mockResolvedValue(
				concert([event('e1', PublishState.PUBLISHED)], { cover: PROCESSED }),
			)
			const { route, host } = await build(m)

			await pick(route)
			await route.save()
			await tasksSettled()

			expect(route.renderedCover).toBe(PROCESSED)
			expect(route.coverProcessing).toBe(false)
			expect(host.textContent).not.toContain('still being processed')
		})
	})
})
