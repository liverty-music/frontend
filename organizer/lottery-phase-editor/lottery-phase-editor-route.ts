import type { Params } from '@aurelia/router'
import { IRouter } from '@aurelia/router'
import type { LotterySalesPhase } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_application_pb.js'
import { ILogger, resolve } from 'aurelia'
import { Code, toOrganizerErrorMessage } from '../services/connect-error-copy'
import { ILotteryPhaseClient } from '../services/lottery-phase-client'
import {
	emptyFormModel,
	isFormValid,
	type LotteryPhaseFormErrors,
	type LotteryPhaseFormModel,
	MAX_WINDOW_DAYS,
	MIN_WINDOW_DAYS,
	toConfigureInput,
	validateLotteryPhaseForm,
} from './lottery-phase-form'

/** Coarse lifecycle phase for the screen. */
type ScreenPhase = 'ready' | 'done'

/**
 * The lottery-phase configuration screen (roadmap ④, task 5.1). Attaches a new
 * lottery sales phase to one of the organizer's PUBLISHED events, addressed by
 * the `eventId` route parameter.
 *
 * Validation mirrors the backend boundary (see {@link validateLotteryPhaseForm})
 * and runs on every input so inline errors — including the 1–14 day window rule,
 * defaulting to a 10-day window — appear before a round-trip. On submit it calls
 * {@link ILotteryPhaseClient.configureLotteryPhase}; INVALID_ARGUMENT,
 * FAILED_PRECONDITION (the event's concert is still a DRAFT), and
 * PERMISSION_DENIED are translated via {@link toOrganizerErrorMessage}. On
 * success the created phase is shown with a link into its status view.
 *
 * ENTRY POINT: the target event id arrives as the `:eventId` route param. The
 * console does not yet surface a per-event "put on sale" affordance from the
 * concerts dashboard (the authoring list is series-scoped and exposes no event
 * ids), so the route is currently reachable only by deep link — see the TODO in
 * `organizer-shell` routing.
 */
export class LotteryPhaseEditorRoute {
	public phase: ScreenPhase = 'ready'

	/** The PUBLISHED event this phase attaches to (from the route). */
	public eventId = ''

	public model: LotteryPhaseFormModel = emptyFormModel()
	public errors: LotteryPhaseFormErrors = {}
	/** Set true after the first save attempt so errors are not shown pre-emptively. */
	public submitted = false
	public saving = false
	public saveError = ''

	/** The created phase, populated on a successful configure. */
	public createdPhase: LotterySalesPhase | undefined

	private abort: AbortController | null = null

	private readonly client = resolve(ILotteryPhaseClient)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('LotteryPhaseEditorRoute')

	// Expose the window bounds to the template for helper copy.
	public readonly minWindowDays = MIN_WINDOW_DAYS
	public readonly maxWindowDays = MAX_WINDOW_DAYS

	public canLoad(params: Params): boolean {
		this.eventId = params.eventId ?? ''
		return true
	}

	public attached(): void {
		this.revalidate()
	}

	public detaching(): void {
		this.abort?.abort()
	}

	public get createdPhaseId(): string {
		return this.createdPhase?.id?.value ?? ''
	}

	public revalidate(): void {
		this.errors = validateLotteryPhaseForm(this.model)
	}

	public get formValid(): boolean {
		return isFormValid(this.errors)
	}

	public async save(): Promise<void> {
		if (this.saving) return
		this.submitted = true
		this.revalidate()
		if (!this.formValid) return
		this.saving = true
		this.saveError = ''
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		try {
			const phase = await this.client.configureLotteryPhase(
				toConfigureInput(this.eventId, this.model),
				abort.signal,
			)
			if (abort.signal.aborted) return
			this.createdPhase = phase
			this.phase = 'done'
		} catch (err) {
			if (abort.signal.aborted) return
			this.saveError = toOrganizerErrorMessage(
				err,
				'Failed to configure the lottery phase.',
				{
					[Code.FailedPrecondition]:
						'This concert is still a draft. Publish it before putting an event on sale.',
					[Code.PermissionDenied]:
						'You are not allowed to configure a lottery phase on this event.',
				},
			)
			this.logger.error('Configure lottery phase failed', {
				eventId: this.eventId,
				err,
			})
		} finally {
			this.saving = false
		}
	}

	/** Navigates to the status view for the just-created phase. */
	public async viewStatus(): Promise<void> {
		if (!this.createdPhaseId) return
		await this.router.load(`../lottery/status/${this.createdPhaseId}`)
	}
}
