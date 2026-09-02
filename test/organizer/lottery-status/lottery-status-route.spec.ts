import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../../helpers/create-container'

// Replace the RPC client module with a fresh interface token so the route binds
// to the test double instead of building a real Connect transport.
const ILotteryPhaseClient = DI.createInterface('ILotteryPhaseClient')

vi.mock('../../../organizer/services/lottery-phase-client', () => ({
	ILotteryPhaseClient,
}))

const { LotteryStatusRoute } = await import(
	'../../../organizer/lottery-status/lottery-status-route'
)

interface MockClient {
	configureLotteryPhase: ReturnType<typeof vi.fn>
	getLotteryPhaseStatus: ReturnType<typeof vi.fn>
}

function build(client: MockClient): InstanceType<typeof LotteryStatusRoute> {
	const container = createTestContainer(
		Registration.instance(ILotteryPhaseClient, client),
	)
	container.register(LotteryStatusRoute)
	const vm = container.get(LotteryStatusRoute)
	vm.canLoad({ phaseId: 'phase-1' })
	return vm
}

/** A proto-Timestamp-ish stub exposing `toDate()`. */
function ts(date: Date): { toDate(): Date } {
	return { toDate: () => date }
}

interface StatusOverrides {
	openTime?: Date
	closeTime?: Date
	drawCompleted?: boolean
	applicationCount?: number
	requestedTicketCount?: number
	winningApplicationCount?: number
	wonTicketCount?: number
	waitlistedApplicationCount?: number
}

function makeStatus(o: StatusOverrides = {}) {
	const open = o.openTime ?? new Date(Date.now() - 60_000)
	const close = o.closeTime ?? new Date(Date.now() + 60_000)
	return {
		phase: {
			id: { value: 'phase-1' },
			openTime: ts(open),
			closeTime: ts(close),
			ticketCapacity: 200,
			maxTicketsPerApplication: 4,
			ticketPrice: 6500n,
		},
		drawCompleted: o.drawCompleted ?? false,
		applicationCount: o.applicationCount ?? 0,
		requestedTicketCount: o.requestedTicketCount ?? 0,
		winningApplicationCount: o.winningApplicationCount ?? 0,
		wonTicketCount: o.wonTicketCount ?? 0,
		waitlistedApplicationCount: o.waitlistedApplicationCount ?? 0,
	}
}

function createMockClient(status?: unknown): MockClient {
	return {
		configureLotteryPhase: vi.fn().mockResolvedValue(undefined),
		getLotteryPhaseStatus: vi.fn().mockResolvedValue(status ?? makeStatus()),
	}
}

describe('LotteryStatusRoute', () => {
	beforeEach(() => vi.clearAllMocks())

	it('renders an open window and pre-draw demand tallies (draw not yet run)', async () => {
		const client = createMockClient(
			makeStatus({
				drawCompleted: false,
				applicationCount: 120,
				requestedTicketCount: 310,
			}),
		)
		const vm = build(client)
		await vm.attached()
		expect(client.getLotteryPhaseStatus).toHaveBeenCalledWith(
			'phase-1',
			expect.anything(),
		)
		expect(vm.phase).toBe('ready')
		expect(vm.view?.windowOpen).toBe(true)
		expect(vm.view?.windowLabel).toBe('Open')
		expect(vm.view?.drawCompleted).toBe(false)
		expect(vm.view?.applicationCount).toBe(120)
		expect(vm.view?.requestedTicketCount).toBe(310)
		// Outcome tallies remain zero pre-draw.
		expect(vm.view?.winningApplicationCount).toBe(0)
		expect(vm.view?.wonTicketCount).toBe(0)
		expect(vm.view?.waitlistedApplicationCount).toBe(0)
	})

	it('labels a not-yet-open window', async () => {
		const client = createMockClient(
			makeStatus({
				openTime: new Date(Date.now() + 60_000),
				closeTime: new Date(Date.now() + 120_000),
			}),
		)
		const vm = build(client)
		await vm.attached()
		expect(vm.view?.windowOpen).toBe(false)
		expect(vm.view?.windowLabel).toBe('Not yet open')
	})

	it('renders a closed window with post-draw outcome tallies', async () => {
		const client = createMockClient(
			makeStatus({
				openTime: new Date(Date.now() - 120_000),
				closeTime: new Date(Date.now() - 60_000),
				drawCompleted: true,
				applicationCount: 500,
				requestedTicketCount: 900,
				winningApplicationCount: 110,
				wonTicketCount: 200,
				waitlistedApplicationCount: 390,
			}),
		)
		const vm = build(client)
		await vm.attached()
		expect(vm.view?.windowOpen).toBe(false)
		expect(vm.view?.windowLabel).toBe('Closed')
		expect(vm.view?.drawCompleted).toBe(true)
		expect(vm.view?.winningApplicationCount).toBe(110)
		expect(vm.view?.wonTicketCount).toBe(200)
		expect(vm.view?.waitlistedApplicationCount).toBe(390)
		expect(vm.view?.ticketPrice).toBe(6500)
	})

	it('reports empty when the response carries no phase', async () => {
		const client = createMockClient({
			phase: undefined,
			drawCompleted: false,
			applicationCount: 0,
			requestedTicketCount: 0,
			winningApplicationCount: 0,
			wonTicketCount: 0,
			waitlistedApplicationCount: 0,
		})
		const vm = build(client)
		await vm.attached()
		expect(vm.phase).toBe('ready')
		expect(vm.isEmpty).toBe(true)
	})

	it('surfaces a PERMISSION_DENIED error state', async () => {
		const client = createMockClient()
		client.getLotteryPhaseStatus = vi
			.fn()
			.mockRejectedValue(new ConnectError('nope', Code.PermissionDenied))
		const vm = build(client)
		await vm.attached()
		expect(vm.phase).toBe('error')
		expect(vm.loadError).toContain('not allowed')
	})
})
