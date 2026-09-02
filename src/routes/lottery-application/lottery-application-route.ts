import type { Params } from '@aurelia/router'
import { TicketApplicationState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_application_pb.js'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { ILotteryRpcClient } from '../../adapter/rpc/client/lottery-client'

/**
 * Discrete UI phases of the my-application / result view.
 *   - `loading`  — the initial `getMyApplication` round-trip is in flight.
 *   - `empty`    — the caller has no application for this phase (nothing to show).
 *   - `error`    — the load failed (non-NotFound); `error` carries the copy.
 *   - `loaded`   — an application is present; `application` + `resultState` drive
 *                  the render (pre-draw "抽選待ち" vs. post-draw result).
 */
export type ApplicationViewStep = 'loading' | 'empty' | 'error' | 'loaded'

/**
 * The visual bucket the view renders. Derived from the application's
 * `TicketApplicationState`: pre-draw APPLIED shows the waiting state; WON / LOST /
 * WITHDRAWN show the post-draw result prominently.
 */
export type ResultKind = 'waiting' | 'won' | 'lost' | 'withdrawn'

/**
 * Fan-facing lottery MY-APPLICATION + RESULT view (roadmap ④, tasks 4.2/4.3).
 * Loads the caller's application for a phase via `getMyApplication` and renders:
 *   - the requested ticket count and 本人確認 summary,
 *   - the current state with clear Japanese labels (Applied / Won / Lost /
 *     Withdrawn), including the pre-draw "抽選待ち" state,
 *   - the post-draw result prominently (当選 / 落選 / 取下げ済み), noting the
 *     card charge (on win) or hold release (on loss/withdrawal),
 *   - a "申込を取下げる" action while the application is APPLIED (before the draw),
 *     which calls `withdrawApplication` after a confirm step and reflects the
 *     WITHDRAWN state.
 *
 * The whole view renders from `getMyApplication` alone: its
 * `TicketApplicationState` already distinguishes pre-draw (APPLIED → 抽選待ち)
 * from the post-draw result (WON / LOST / WITHDRAWN), so no separate `getResult`
 * round-trip is needed here.
 *
 * DEFERRED to a later increment (task 5.x): the organizer console.
 *
 * NOTE (phase metadata): the fan surface of `LotteryService` exposes no
 * phase-load RPC, so ticket price / max are not shown here — only the
 * application's own recorded `requestedTicketCount`. TODO(lottery): show phase
 * context (event, price) once a fan-facing phase-read RPC exists.
 */
export class LotteryApplicationRoute {
	// ── Inputs (bindable / route params) ──────────────────────────────────────
	public phaseId = ''

	// ── View state ────────────────────────────────────────────────────────────
	public step: ApplicationViewStep = 'loading'
	public error = ''

	/** The loaded application (plain fields read in the template). */
	public applicationCount = 0
	public applicantName = ''
	public applicantPhone = ''
	private state: TicketApplicationState = TicketApplicationState.UNSPECIFIED

	/** Confirm-step gate for the withdraw action. */
	public confirmingWithdraw = false
	/** True while the withdraw round-trip is in flight (disables the action). */
	public withdrawing = false

	private readonly logger = resolve(ILogger).scopeTo('LotteryApplicationRoute')
	private readonly lottery = resolve(ILotteryRpcClient)
	private abortController: AbortController | null = null

	public loading(params: Params): void {
		if (params.phaseId) this.phaseId = String(params.phaseId)
		// Abort any request still in flight from a prior activation (Aurelia may
		// reuse this VM instance on a params-only re-navigation) so a stale
		// response for the previous phase can never write into the new view.
		this.abortController?.abort()
		this.abortController = new AbortController()
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
	}

	/**
	 * Loads the caller's application for the phase. No application → `empty`; any
	 * non-cancel failure → `error`. On success the flat display fields are
	 * populated and the step flips to `loaded`.
	 */
	public async load(): Promise<void> {
		this.step = 'loading'
		this.error = ''
		try {
			const app = await this.lottery.getMyApplication(
				this.phaseId,
				this.abortController?.signal,
			)
			if (!app) {
				this.step = 'empty'
				return
			}
			this.applicationCount = app.requestedTicketCount
			this.applicantName = app.identity?.fullName ?? ''
			this.applicantPhone = app.identity?.phoneNumber ?? ''
			this.state = app.state
			this.step = 'loaded'
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.error('getMyApplication failed', { error: err })
			this.error =
				'お申し込み内容の読み込みに失敗しました。時間をおいて再度お試しください。'
			this.step = 'error'
		}
	}

	// ── Derived state ─────────────────────────────────────────────────────────

	/** The visual bucket the template renders for the current state. */
	public get resultKind(): ResultKind {
		switch (this.state) {
			case TicketApplicationState.WON:
				return 'won'
			case TicketApplicationState.LOST:
				return 'lost'
			case TicketApplicationState.WITHDRAWN:
				return 'withdrawn'
			default:
				return 'waiting'
		}
	}

	/** Clear Japanese label for the current lifecycle state. */
	public get stateLabel(): string {
		switch (this.state) {
			case TicketApplicationState.APPLIED:
				return '抽選待ち'
			case TicketApplicationState.WON:
				return '当選'
			case TicketApplicationState.LOST:
				return '落選'
			case TicketApplicationState.WITHDRAWN:
				return '取下げ済み'
			default:
				return '—'
		}
	}

	/**
	 * Withdraw is offered only while the application is APPLIED (before the draw):
	 * once WON / LOST / WITHDRAWN it is hidden. `withdrawing` disables it during
	 * the round-trip.
	 */
	public get canWithdraw(): boolean {
		return this.state === TicketApplicationState.APPLIED && !this.withdrawing
	}

	// ── Withdraw flow (task 4.3) ───────────────────────────────────────────────

	/** Opens the confirm step for the withdraw action. */
	public askWithdraw(): void {
		if (!this.canWithdraw) return
		this.error = ''
		this.confirmingWithdraw = true
	}

	/** Dismisses the confirm step without withdrawing. */
	public cancelWithdraw(): void {
		this.confirmingWithdraw = false
	}

	/**
	 * Confirms the withdrawal: calls `withdrawApplication`, then reflects the
	 * WITHDRAWN state (the card authorization is released, noted in the template).
	 * FAILED_PRECONDITION (the draw already ran) is surfaced gracefully and the
	 * application is reloaded so the now-final result renders.
	 */
	public async confirmWithdraw(): Promise<void> {
		if (this.state !== TicketApplicationState.APPLIED) return
		this.withdrawing = true
		this.error = ''
		try {
			await this.lottery.withdrawApplication(
				this.phaseId,
				this.abortController?.signal,
			)
			this.state = TicketApplicationState.WITHDRAWN
			this.confirmingWithdraw = false
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
				// The draw ran between load and withdraw: reload to show the result,
				// then surface the note (load() clears `error`, so set it after).
				this.confirmingWithdraw = false
				await this.load()
				this.error =
					'抽選が確定したため取下げできませんでした。最新の結果を表示します。'
				return
			}
			this.logger.error('withdrawApplication failed', { error: err })
			this.error = '取下げに失敗しました。もう一度お試しください。'
		} finally {
			this.withdrawing = false
		}
	}
}
