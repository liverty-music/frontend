import { bindable, ILogger, resolve } from 'aurelia'
import {
	IOrganizerClient,
	type Organizer,
	type SellerDetailsInput,
} from '../../services/organizer-client'
import { toUserMessage } from '../organizer-error-message'
import {
	bpsToPercentText,
	EMPTY_SELLER_DETAILS,
	hasSellerDetailsErrors,
	parsePercentToBps,
	type SellerDetailsErrors,
	toSellerDetailsInput,
	trimSellerDetails,
	validateSellerDetails,
} from './commercial-terms-form'

type LoadPhase = 'loading' | 'ready' | 'error'

/** Two-way bound form values for the seller details. */
type SellerDetailsForm = { -readonly [K in keyof SellerDetailsInput]: string }

/**
 * The admin's editor for an Organizer's commercial terms, shown in the
 * Organizer detail pane: the 特商法 seller details (saved as a whole, all five
 * values required) and the platform fee rate (entered as a percentage with up
 * to two decimals, sent as integer basis points).
 *
 * It reads the Organizer with `Get` whenever `organizerId` is set or changes,
 * prefills both forms, validates next to each field before sending, and after
 * a save shows the values the server returns. Each form saves independently,
 * so saving one never discards unsaved edits in the other. RPC errors are
 * translated with the shared organizer error copy and logged.
 */
export class OrganizerCommercialTerms {
	@bindable public organizerId = ''

	public phase: LoadPhase = 'loading'
	public loadError = ''

	/** Seller-details form. */
	public seller: SellerDetailsForm = { ...EMPTY_SELLER_DETAILS }
	public sellerErrors: SellerDetailsErrors = {}
	/** Whether the Organizer has stored seller details (its events can go on sale). */
	public hasSellerDetails = false
	public savingSeller = false
	public sellerSaveError = ''
	public sellerSaved = false

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
			this.applySellerDetails(organizer)
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

	// --- Seller details -----------------------------------------------------

	public async saveSellerDetails(): Promise<void> {
		if (this.savingSeller) return
		const organizerId = this.organizerId
		const details = trimSellerDetails(this.seller)
		this.sellerSaved = false
		this.sellerSaveError = ''
		const errors = validateSellerDetails(details)
		this.sellerErrors = errors
		if (hasSellerDetailsErrors(errors)) return

		this.savingSeller = true
		try {
			const organizer = await this.client.updateSellerDetails(
				organizerId,
				details,
			)
			const stored = await this.requireOrganizer(organizerId, organizer)
			if (organizerId !== this.organizerId) return
			this.applySellerDetails(stored)
			this.sellerSaved = true
		} catch (err) {
			this.sellerSaveError = toUserMessage(
				err,
				'Failed to save the seller details.',
			)
			this.logger.error('Update seller details failed', { organizerId, err })
		} finally {
			this.savingSeller = false
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

	private applySellerDetails(organizer: Organizer): void {
		this.seller = toSellerDetailsInput(organizer.sellerDetails)
		this.hasSellerDetails = organizer.sellerDetails !== undefined
		this.sellerErrors = {}
	}

	private applyFeeRate(organizer: Organizer): void {
		this.feeRateText = bpsToPercentText(organizer.platformFeeRateBps)
		this.feeRateError = ''
	}

	private resetFeedback(): void {
		this.sellerErrors = {}
		this.sellerSaveError = ''
		this.sellerSaved = false
		this.feeRateError = ''
		this.feeRateSaveError = ''
		this.feeRateSaved = false
	}
}
