import {
	TicketApplication,
	TicketApplicationState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_application_pb.js'
import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}

const mockLottery = {
	createAuthorization: vi.fn(),
	apply: vi.fn(),
	withdrawApplication: vi.fn(async () => undefined),
	getMyApplication: vi.fn(
		async () => undefined as TicketApplication | undefined,
	),
	getResult: vi.fn(async () => undefined as TicketApplication | undefined),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				ILotteryRpcClient: mockLottery,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { LotteryApplicationRoute } from './lottery-application-route'

// Flush pending microtasks (loading() kicks off an async load()).
const flush = () => new Promise((r) => setTimeout(r, 0))

function appWith(state: TicketApplicationState): TicketApplication {
	return new TicketApplication({
		requestedTicketCount: 2,
		identity: { fullName: '山田太郎', phoneNumber: '09012345678' },
		state,
	})
}

async function makeSut(): Promise<LotteryApplicationRoute> {
	const sut = new LotteryApplicationRoute()
	sut.loading({ phaseId: 'phase-1' })
	await flush()
	return sut
}

describe('LotteryApplicationRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockLottery.getMyApplication.mockResolvedValue(undefined)
		mockLottery.getResult.mockResolvedValue(undefined)
		mockLottery.withdrawApplication.mockResolvedValue(undefined)
	})

	describe('load states', () => {
		it('shows empty when the caller has no application', async () => {
			mockLottery.getMyApplication.mockResolvedValue(undefined)
			const sut = await makeSut()
			expect(sut.step).toBe('empty')
		})

		it('surfaces a load failure as the error state', async () => {
			mockLottery.getMyApplication.mockRejectedValueOnce(new Error('boom'))
			const sut = await makeSut()
			expect(sut.step).toBe('error')
			expect(sut.error).not.toBe('')
		})

		it('loads the application and its 本人確認 summary', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.APPLIED),
			)
			const sut = await makeSut()
			expect(sut.step).toBe('loaded')
			expect(sut.applicationCount).toBe(2)
			expect(sut.applicantName).toBe('山田太郎')
			expect(sut.applicantPhone).toBe('09012345678')
		})
	})

	describe('state → UI mapping', () => {
		it('maps APPLIED to the waiting (抽選待ち) state', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.APPLIED),
			)
			const sut = await makeSut()
			expect(sut.resultKind).toBe('waiting')
			expect(sut.stateLabel).toBe('抽選待ち')
		})

		it('maps WON to 当選', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.WON),
			)
			const sut = await makeSut()
			expect(sut.resultKind).toBe('won')
			expect(sut.stateLabel).toBe('当選')
		})

		it('maps LOST to 落選', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.LOST),
			)
			const sut = await makeSut()
			expect(sut.resultKind).toBe('lost')
			expect(sut.stateLabel).toBe('落選')
		})

		it('maps WITHDRAWN to 取下げ済み', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.WITHDRAWN),
			)
			const sut = await makeSut()
			expect(sut.resultKind).toBe('withdrawn')
			expect(sut.stateLabel).toBe('取下げ済み')
		})
	})

	describe('withdraw availability', () => {
		it('offers withdraw only while APPLIED', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.APPLIED),
			)
			const sut = await makeSut()
			expect(sut.canWithdraw).toBe(true)
		})

		it('hides withdraw once WON / LOST / WITHDRAWN', async () => {
			for (const state of [
				TicketApplicationState.WON,
				TicketApplicationState.LOST,
				TicketApplicationState.WITHDRAWN,
			]) {
				mockLottery.getMyApplication.mockResolvedValue(appWith(state))
				const sut = await makeSut()
				expect(sut.canWithdraw).toBe(false)
			}
		})
	})

	describe('withdraw happy path (APPLIED → confirm → WITHDRAWN)', () => {
		it('withdraws after confirm and reflects the withdrawn state', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.APPLIED),
			)
			const sut = await makeSut()

			sut.askWithdraw()
			expect(sut.confirmingWithdraw).toBe(true)

			await sut.confirmWithdraw()

			expect(mockLottery.withdrawApplication).toHaveBeenCalledWith(
				'phase-1',
				expect.anything(),
			)
			expect(sut.resultKind).toBe('withdrawn')
			expect(sut.stateLabel).toBe('取下げ済み')
			expect(sut.confirmingWithdraw).toBe(false)
			expect(sut.canWithdraw).toBe(false)
		})

		it('cancelWithdraw dismisses the confirm step without calling the RPC', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.APPLIED),
			)
			const sut = await makeSut()
			sut.askWithdraw()
			sut.cancelWithdraw()
			expect(sut.confirmingWithdraw).toBe(false)
			expect(mockLottery.withdrawApplication).not.toHaveBeenCalled()
		})

		it('does not withdraw when not APPLIED', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.WON),
			)
			const sut = await makeSut()
			sut.askWithdraw()
			await sut.confirmWithdraw()
			expect(mockLottery.withdrawApplication).not.toHaveBeenCalled()
			expect(sut.resultKind).toBe('won')
		})
	})

	describe('withdraw error surfacing', () => {
		it('handles FAILED_PRECONDITION (draw already ran) by reloading', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.APPLIED),
			)
			const sut = await makeSut()

			mockLottery.withdrawApplication.mockRejectedValueOnce(
				new ConnectError('draw ran', Code.FailedPrecondition),
			)
			// The reload after the precondition failure returns the final WON result.
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.WON),
			)

			sut.askWithdraw()
			await sut.confirmWithdraw()

			expect(sut.error).not.toBe('')
			expect(sut.resultKind).toBe('won')
			expect(sut.confirmingWithdraw).toBe(false)
		})

		it('surfaces a generic withdraw failure without changing state', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.APPLIED),
			)
			const sut = await makeSut()

			mockLottery.withdrawApplication.mockRejectedValueOnce(new Error('boom'))
			sut.askWithdraw()
			await sut.confirmWithdraw()

			expect(sut.error).not.toBe('')
			expect(sut.resultKind).toBe('waiting')
			expect(sut.withdrawing).toBe(false)
		})
	})

	describe('pre-draw handling', () => {
		it('renders the waiting state for an APPLIED application (抽選待ち)', async () => {
			mockLottery.getMyApplication.mockResolvedValue(
				appWith(TicketApplicationState.APPLIED),
			)
			const sut = await makeSut()

			// The view derives pre-draw purely from getMyApplication's state; no
			// separate getResult round-trip.
			expect(sut.resultKind).toBe('waiting')
			expect(sut.stateLabel).toBe('抽選待ち')
			expect(sut.step).toBe('loaded')
		})
	})
})
