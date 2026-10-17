import { bindable, ILogger, resolve } from 'aurelia'
import {
	type BusinessDetailsInput,
	IOrganizerClient,
	type Organizer,
} from '../../services/organizer-client'
import { toUserMessage } from '../organizer-error-message'
import {
	type BusinessDetailsErrors,
	bpsToPercentText,
	EMPTY_BUSINESS_DETAILS,
	hasBusinessDetailsErrors,
	hasStoredBusinessDetails,
	parsePercentToBps,
	toBusinessDetailsInput,
	trimBusinessDetails,
	validateBusinessDetails,
} from './commercial-terms-form'

type LoadPhase = 'loading' | 'ready' | 'error'

/** Two-way bound form values for the business details. */
type BusinessDetailsForm = {
	-readonly [K in keyof BusinessDetailsInput]: string
}

/**
 * The admin's editor for an Organizer's commercial terms, shown in the
 * Organizer detail pane: the 特商法 business details (saved as a whole, all five
 * values required) and the platform fee rate (entered as a percentage with up
 * to two decimals, sent as integer basis points).
 *
 * It reads the Organizer with `Get` whenever `organizerId` is set or changes,
 * prefills both forms, validates next to each field before sending, and after
 * a save shows the values the server returns. Each form saves independently,
 * so saving one never discards unsaved edits in the other. RPC errors are
 * translated with the shared organizer error copy and logged.
 *
 * A deactivated Organizer refuses both saves, so with `deactivated` set
 * neither form is shown.
 */
export class OrganizerCommercialTerms {
	@bindable public organizerId = ''
	/** Hides both forms: the server refuses every save for a deactivated Organizer. */
	@bindable public deactivated = false

	public phase: LoadPhase = 'loading'
	public loadError = ''

	/** Business-details form. */
	public business: BusinessDetailsForm = { ...EMPTY_BUSINESS_DETAILS }
	public businessErrors: BusinessDetailsErrors = {}
	/** Whether the Organizer has all business details stored (its events can go on sale). */
	public hasBusinessDetails = false
	public savingBusiness = false
	public businessSaveError = ''
	public businessSaved = false

	/** Platform-fee-rate form, as percentage text ("5.00"). */
	public feeRateText = ''
	public feeRateError = ''
	public savingFeeRate = false
	public feeRateSaveError = ''
	public feeRateSaved = false

	/** Incremented per load so a superseded Get never overwrites a newer one. */
	private loadSeq = 0

	private readonly client = resolve(IOrganizerClient)
	private readonly logger = resolve(ILogger).scopeTo('OrganizerCommercialTerms')

	public async attached(): Promise<void> {
		await this.load()
	}

	public organizerIdChanged(): void {
		void this.load()
	}

	public async load(): Promise<void> {
		const organizerId = this.organizerId
		const seq = ++this.loadSeq
		this.phase = 'loading'
		this.loadError = ''
		this.resetFeedback()
		if (organizerId === '') return
		try {
			const organizer = await this.requireOrganizer(organizerId)
			if (seq !== this.loadSeq) return
			this.applyBusinessDetails(organizer)
			this.applyFeeRate(organizer)
			this.phase = 'ready'
		} catch (err) {
			if (seq !== this.loadSeq) return
			this.loadError = toUserMessage(err, 'Failed to load the organizer.')
			this.phase = 'error'
			this.logger.error('Failed to load organizer commercial terms', {
				organizerId,
				err,
			})
		}
	}

	// --- Business details ---------------------------------------------------

	public async saveBusinessDetails(): Promise<void> {
		if (this.savingBusiness) return
		const organizerId = this.organizerId
		const details = trimBusinessDetails(this.business)
		this.businessSaved = false
		this.businessSaveError = ''
		const errors = validateBusinessDetails(details)
		this.businessErrors = errors
		if (hasBusinessDetailsErrors(errors)) return

		this.savingBusiness = true
		try {
			const organizer = await this.client.setBusinessDetails(
				organizerId,
				details,
			)
			const stored = await this.requireOrganizer(organizerId, organizer)
			if (organizerId !== this.organizerId) return
			this.applyBusinessDetails(stored)
			this.businessSaved = true
		} catch (err) {
			this.businessSaveError = toUserMessage(
				err,
				'Failed to save the business details.',
			)
			this.logger.error('Set business details failed', { organizerId, err })
		} finally {
			this.savingBusiness = false
		}
	}

	// --- Platform fee rate --------------------------------------------------

	public async saveFeeRate(): Promise<void> {
		if (this.savingFeeRate) return
		const organizerId = this.organizerId
		this.feeRateSaved = false
		this.feeRateSaveError = ''
		const parsed = parsePercentToBps(this.feeRateText)
		if (parsed.ok === false) {
			this.feeRateError = parsed.error
			return
		}
		this.feeRateError = ''

		this.savingFeeRate = true
		try {
			const organizer = await this.client.setPlatformFeeRate(
				organizerId,
				parsed.bps,
			)
			const stored = await this.requireOrganizer(organizerId, organizer)
			if (organizerId !== this.organizerId) return
			this.applyFeeRate(stored)
			this.feeRateSaved = true
		} catch (err) {
			this.feeRateSaveError = toUserMessage(
				err,
				'Failed to save the platform fee rate.',
			)
			this.logger.error('Set platform fee rate failed', {
				organizerId,
				platformFeeRateBps: parsed.bps,
				err,
			})
		} finally {
			this.savingFeeRate = false
		}
	}

	// --- Helpers ------------------------------------------------------------

	/**
	 * Returns the Organizer a save responded with, or reads it with Get when the
	 * response carried none. A missing Organizer is reported as an error rather
	 * than rendered as empty values.
	 */
	private async requireOrganizer(
		organizerId: string,
		fromResponse?: Organizer,
	): Promise<Organizer> {
		const organizer = fromResponse ?? (await this.client.get(organizerId))
		if (!organizer) throw new Error('The organizer could not be found.')
		return organizer
	}

	private applyBusinessDetails(organizer: Organizer): void {
		this.business = toBusinessDetailsInput(organizer)
		this.hasBusinessDetails = hasStoredBusinessDetails(organizer)
		this.businessErrors = {}
	}

	private applyFeeRate(organizer: Organizer): void {
		this.feeRateText = bpsToPercentText(organizer.platformFeeRateBps)
		this.feeRateError = ''
	}

	private resetFeedback(): void {
		this.businessErrors = {}
		this.businessSaveError = ''
		this.businessSaved = false
		this.feeRateError = ''
		this.feeRateSaveError = ''
		this.feeRateSaved = false
	}
}
