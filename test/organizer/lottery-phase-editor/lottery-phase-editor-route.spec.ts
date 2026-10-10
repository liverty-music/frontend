import { IRouter } from '@aurelia/router'
import { createFixture } from '@aurelia/testing'
import {
	type LotterySalesPhase,
	LotterySalesPhaseSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_application_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyFormModel } from '../../../organizer/lottery-phase-editor/lottery-phase-form'
import type { AuthoredSeries } from '../../../organizer/services/concert-authoring-client'
import { createTestContainer } from '../../helpers/create-container'
import { authoredSeries } from '../authored-series'

// Replace the RPC client module with a fresh interface token so the route binds
// to the test double instead of building a real Connect transport.
const ILotteryPhaseClient = DI.createInterface('ILotteryPhaseClient')

vi.mock('../../../organizer/services/lottery-phase-client', () => ({
	ILotteryPhaseClient,
}))

const IConcertAuthoringClient = DI.createInterface('IConcertAuthoringClient')
vi.mock('../../../organizer/services/concert-authoring-client', () => ({
	IConcertAuthoringClient,
}))

const { LotteryPhaseEditorRoute } = await import(
	'../../../organizer/lottery-phase-editor/lottery-phase-editor-route'
)

interface MockClient {
	configureLotteryPhase: ReturnType<typeof vi.fn>
	getLotteryPhaseStatus: ReturnType<typeof vi.fn>
}

interface MockRouter {
	load: ReturnType<typeof vi.fn>
}

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
	return {
		configureLotteryPhase: vi.fn().mockResolvedValue(undefined),
		getLotteryPhaseStatus: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

function makePhase(id: string): LotterySalesPhase {
	return create(LotterySalesPhaseSchema, { id: { value: id } })
}

/** The operator's concerts, holding event-1 with or without a start time. */
function concertsWith(startTime: boolean): AuthoredSeries[] {
	return [
		authoredSeries({
			series: { id: { value: 'series-1' } },
			events: [
				{
					id: { value: 'event-1' },
					...(startTime
						? { startTime: { value: timestampFromDate(new Date()) } }
						: {}),
				},
			],
		}),
	]
}

function build(
	client: MockClient,
	router: MockRouter = { load: vi.fn().mockResolvedValue(undefined) },
	concerts: { list: ReturnType<typeof vi.fn> } = {
		list: vi.fn().mockResolvedValue(concertsWith(true)),
	},
): InstanceType<typeof LotteryPhaseEditorRoute> {
	const container = createTestContainer(
		Registration.instance(ILotteryPhaseClient, client),
		Registration.instance(IRouter, router),
		Registration.instance(IConcertAuthoringClient, concerts),
	)
	container.register(LotteryPhaseEditorRoute)
	const vm = container.get(LotteryPhaseEditorRoute)
	vm.canLoad({ eventId: 'event-1' })
	// The start-time check normally runs on attach.
	vm.eventCheck = 'ok'
	return vm
}

function fillValid(vm: InstanceType<typeof LotteryPhaseEditorRoute>): void {
	vm.model = emptyFormModel(new Date(2026, 0, 1, 12, 0, 0))
	vm.model.ticketCapacity = '200'
	vm.model.maxTicketsPerApplication = '4'
	vm.model.ticketPrice = '6500'
	vm.revalidate()
}

describe('LotteryPhaseEditorRoute', () => {
	beforeEach(() => vi.clearAllMocks())

	it('captures the event id from the route param', () => {
		const vm = build(createMockClient())
		expect(vm.eventId).toBe('event-1')
	})

	it('does not submit an invalid form and shows errors', async () => {
		const client = createMockClient()
		const vm = build(client)
		vm.model = emptyFormModel(new Date(2026, 0, 1, 12, 0, 0)) // blank numeric fields
		vm.revalidate()
		await vm.save()
		expect(vm.submitted).toBe(true)
		expect(vm.formValid).toBe(false)
		expect(client.configureLotteryPhase).not.toHaveBeenCalled()
	})

	it('configures a phase on the happy path and surfaces the created phase', async () => {
		const client = createMockClient({
			configureLotteryPhase: vi.fn().mockResolvedValue(makePhase('phase-9')),
		})
		const vm = build(client)
		fillValid(vm)
		await vm.save()
		expect(client.configureLotteryPhase).toHaveBeenCalledTimes(1)
		const [input] = client.configureLotteryPhase.mock.calls[0]
		expect(input.eventId).toBe('event-1')
		expect(input.ticketCapacity).toBe(200)
		expect(input.ticketPrice).toBe(6500)
		expect(vm.phase).toBe('done')
		expect(vm.createdPhaseId).toBe('phase-9')
		expect(vm.saveError).toBe('')
	})

	it('surfaces FAILED_PRECONDITION (draft concert or no start time) copy', async () => {
		const client = createMockClient({
			configureLotteryPhase: vi
				.fn()
				.mockRejectedValue(new ConnectError('draft', Code.FailedPrecondition)),
		})
		const vm = build(client)
		fillValid(vm)
		await vm.save()
		expect(vm.phase).toBe('ready')
		expect(vm.saveError).toContain('set its start time')
	})

	it('surfaces PERMISSION_DENIED copy', async () => {
		const client = createMockClient({
			configureLotteryPhase: vi
				.fn()
				.mockRejectedValue(new ConnectError('nope', Code.PermissionDenied)),
		})
		const vm = build(client)
		fillValid(vm)
		await vm.save()
		expect(vm.saveError).toContain('not allowed')
	})

	it('surfaces INVALID_ARGUMENT raw message', async () => {
		const client = createMockClient({
			configureLotteryPhase: vi
				.fn()
				.mockRejectedValue(
					new ConnectError('capacity must be positive', Code.InvalidArgument),
				),
		})
		const vm = build(client)
		fillValid(vm)
		await vm.save()
		expect(vm.saveError).toContain('capacity must be positive')
	})

	it('navigates to the status view for the created phase', async () => {
		const router = { load: vi.fn().mockResolvedValue(undefined) }
		const client = createMockClient({
			configureLotteryPhase: vi.fn().mockResolvedValue(makePhase('phase-9')),
		})
		const vm = build(client, router)
		fillValid(vm)
		await vm.save()
		await vm.viewStatus()
		expect(router.load).toHaveBeenCalledWith('../lottery/status/phase-9')
	})

	describe('an event goes on sale only with its start time', () => {
		it('says the start time must be set first, links to the concert editor, and offers no save', async () => {
			// @spec components/infrastructure/organizer/web/route/lottery-phase-editor "Start time not set"
			const client = createMockClient()
			const concerts = { list: vi.fn().mockResolvedValue(concertsWith(false)) }
			const fixture = createFixture
				.html(
					'<lottery-phase-editor-route component.ref="route"></lottery-phase-editor-route>',
				)
				.deps(
					LotteryPhaseEditorRoute,
					Registration.instance(ILotteryPhaseClient, client),
					Registration.instance(IRouter, { load: vi.fn() }),
					Registration.instance(IConcertAuthoringClient, concerts),
				)
				.build()
			await fixture.started
			const vm = (
				fixture.component as {
					route: InstanceType<typeof LotteryPhaseEditorRoute>
				}
			).route
			vm.canLoad({ eventId: 'event-1' })
			await vm.checkEvent()

			expect(vm.eventCheck).toBe('no-start-time')
			const host = fixture.appHost
			expect(host.textContent).toContain('Set the start time first')
			const editorLink = Array.from(host.querySelectorAll('a')).find((a) =>
				a.textContent?.includes('concert editor'),
			)
			// Without a router in the fixture, the interpolated `load` lands on the
			// element's property; with the router it is the navigation target.
			expect(
				(editorLink as unknown as { load?: string } | undefined)?.load,
			).toBe('../concerts/edit/series-1')
			expect(host.querySelector('form')).toBeNull()
			expect(host.querySelector('button[type="submit"]')).toBeNull()

			fillValid(vm)
			await vm.save()
			expect(client.configureLotteryPhase).not.toHaveBeenCalled()
		})

		it('goes on sale as usual without an open time', async () => {
			const vm = build(createMockClient(), undefined, {
				list: vi.fn().mockResolvedValue(concertsWith(true)),
			})
			await vm.checkEvent()
			expect(vm.eventCheck).toBe('ok')
		})

		it('leaves the decision to the server when the event cannot be read', async () => {
			const vm = build(createMockClient(), undefined, {
				list: vi.fn().mockRejectedValue(new Error('offline')),
			})
			await vm.checkEvent()
			expect(vm.eventCheck).toBe('ok')
		})
	})
})
