import { IRouter } from '@aurelia/router'
import {
	LotterySalesPhase,
	LotterySalesPhaseId,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_application_pb.js'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyFormModel } from '../../../organizer/lottery-phase-editor/lottery-phase-form'
import { createTestContainer } from '../../helpers/create-container'

// Replace the RPC client module with a fresh interface token so the route binds
// to the test double instead of building a real Connect transport.
const ILotteryPhaseClient = DI.createInterface('ILotteryPhaseClient')

vi.mock('../../../organizer/services/lottery-phase-client', () => ({
	ILotteryPhaseClient,
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
	return new LotterySalesPhase({ id: new LotterySalesPhaseId({ value: id }) })
}

function build(
	client: MockClient,
	router: MockRouter = { load: vi.fn().mockResolvedValue(undefined) },
): InstanceType<typeof LotteryPhaseEditorRoute> {
	const container = createTestContainer(
		Registration.instance(ILotteryPhaseClient, client),
		Registration.instance(IRouter, router),
	)
	container.register(LotteryPhaseEditorRoute)
	const vm = container.get(LotteryPhaseEditorRoute)
	vm.canLoad({ eventId: 'event-1' })
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

	it('surfaces FAILED_PRECONDITION (concert still a draft) copy', async () => {
		const client = createMockClient({
			configureLotteryPhase: vi
				.fn()
				.mockRejectedValue(new ConnectError('draft', Code.FailedPrecondition)),
		})
		const vm = build(client)
		fillValid(vm)
		await vm.save()
		expect(vm.phase).toBe('ready')
		expect(vm.saveError).toContain('still a draft')
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
})
