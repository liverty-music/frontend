import { IRouter, type Params } from '@aurelia/router'
import type { StripePaymentElement } from '@stripe/stripe-js'
import { ILogger, resolve } from 'aurelia'
import {
	type ApplicantIdentityInput,
	ILotteryRpcClient,
} from '../../adapter/rpc/client/lottery-client'
import { formatJpy } from '../../lib/format-currency'
import { IIdentityVerificationService } from '../../services/identity-verification-service'
import { IStripeService } from '../../services/stripe-service'

/**
 * Discrete UI phases of the apply flow. The fan advances
 * count → identity → payment, then submits. `submitting` covers the
 * confirm-authorization + apply round-trip; `done` is the success terminal.
 *
 * `verify-required` is a pre-flow gate: when the phase requires identity
 * verification (identity-ekyc-jpki) and the fan is UNVERIFIED, the flow parks
 * here — informing them of the requirement and routing them to Settings to
 * verify — before any count/identity/payment step is reachable. The backend
 * still enforces the requirement authoritatively at Apply (FAILED_PRECONDITION);
 * this only surfaces it up-front instead of after a card hold.
 */
export type ApplyStep =
	| 'verify-required'
	| 'count'
	| 'identity'
	| 'payment'
	| 'submitting'
	| 'done'
	| 'unavailable'

/**
 * Fan-facing lottery APPLY flow (roadmap ④). Drives:
 *   1. ticket count selection (1..maxTickets),
 *   2. 本人確認 (full name + phone number),
 *   3. Stripe card *authorization* (manual-capture PaymentIntent) confirmed
 *      with Elements + 3DS, then Apply with the confirmed PaymentIntent ref,
 *   4. the 特商法 final-confirmation copy (rendered by the template).
 *
 * DEFERRED to a later increment (clear TODOs): the my-application / result
 * views, the withdraw UI, and the organizer console. This route only submits
 * an application.
 *
 * NOTE (max/price source): the fan surface of `LotteryService` exposes no
 * phase-load RPC, so `maxTickets` and `ticketPrice` are taken as inputs
 * (bindable props / route params). TODO(lottery): load these from a fan-facing
 * phase-read RPC once the schema adds one, instead of trusting caller-supplied
 * values (the server still authoritatively re-validates count and amount).
 */
export class LotteryApplyRoute {
	// ── Inputs (bindable / route params) ──────────────────────────────────────
	public phaseId = ''
	/** Upper bound for the ticket count picker; server re-validates. */
	public maxTickets = 1
	/** Per-ticket price in JPY minor-unit-free yen (JPY has no minor unit). */
	public ticketPrice = 0
	/**
	 * Whether this phase REQUIRES identity verification (identity-ekyc-jpki).
	 * Caller-supplied (route param / bindable), mirroring `maxTickets`/`ticketPrice`
	 * — the backend re-validates at Apply. When true and the fan is UNVERIFIED, the
	 * flow gates on the `verify-required` step. TODO(lottery): source this from a
	 * fan-facing phase-read RPC once one exists, alongside max/price.
	 */
	public verificationRequired = false

	// ── Flow state ────────────────────────────────────────────────────────────
	public step: ApplyStep = 'count'
	public error = ''

	// Step 1: ticket count.
	public ticketCount = 1

	// Step 2: 本人確認.
	public fullName = ''
	public phoneNumber = ''

	// Step 3: card authorization.
	/** The PaymentIntent reference returned when the authorization is created. */
	public paymentIntentRef = ''
	/**
	 * The PaymentIntent reference AFTER a successful confirm (3DS complete, hold
	 * placed). Once set, a re-submit must NOT re-confirm the (already
	 * requires_capture) PaymentIntent — Stripe rejects re-confirming it — so
	 * confirmAndApply() retries by calling Apply directly with this ref.
	 */
	private confirmedRef = ''
	/** Guards against a double-tap firing two createAuthorization round-trips. */
	public authorizing = false
	/** DOM node the Stripe Payment Element mounts into (captured via `ref`). */
	public paymentElementHost?: HTMLElement

	private readonly logger = resolve(ILogger).scopeTo('LotteryApplyRoute')
	private readonly lottery = resolve(ILotteryRpcClient)
	private readonly stripe = resolve(IStripeService)
	private readonly identity = resolve(IIdentityVerificationService)
	private readonly router = resolve(IRouter)
	private abortController: AbortController | null = null

	// Stripe handles held between createAuthorization and confirm. Typed loosely
	// as unknown-bearing fields would defeat strict typing; instead we keep the
	// concrete Stripe types the service returns.
	private stripeHandles: Awaited<ReturnType<IStripeService['createElements']>> =
		null
	private paymentElement: StripePaymentElement | null = null

	public async loading(params: Params): Promise<void> {
		// Route params override defaults when present; otherwise the bindable
		// inputs (Storybook / parent composition) are used as-is.
		if (params.phaseId) this.phaseId = String(params.phaseId)
		if (params.maxTickets) {
			const n = Number(params.maxTickets)
			if (Number.isFinite(n) && n >= 1) this.maxTickets = Math.floor(n)
		}
		if (params.ticketPrice) {
			const p = Number(params.ticketPrice)
			if (Number.isFinite(p) && p >= 0) this.ticketPrice = Math.floor(p)
		}
		if (params.verificationRequired != null) {
			this.verificationRequired = String(params.verificationRequired) === 'true'
		}

		// Abort any request still in flight from a prior activation (Aurelia may
		// reuse this VM instance on a params-only re-navigation) before starting a
		// fresh controller, so a stale response can never write into the new view.
		this.abortController?.abort()
		this.abortController = new AbortController()

		if (!this.stripe.isConfigured) {
			// No publishable key provisioned for this environment: fail closed with
			// a friendly state instead of attempting to load Stripe.js.
			this.step = 'unavailable'
			return
		}

		// Verification gate (identity-ekyc-jpki 5.2): when the phase requires
		// verification, check the fan's status up-front and park them on the
		// `verify-required` step if they are UNVERIFIED — informing them and
		// routing them to Settings before any card hold. On a status-load failure
		// we fail OPEN (proceed to the flow): the backend re-validates at Apply, so
		// the requirement is never bypassed, only surfaced later in that case.
		if (this.verificationRequired) {
			try {
				const status = await this.identity.getMyVerificationStatus(
					this.abortController.signal,
				)
				if (status.level !== 'identityVerified') {
					this.step = 'verify-required'
				}
			} catch (err) {
				if ((err as Error).name !== 'AbortError') {
					this.logger.warn('verification status load failed; failing open', {
						error: err,
					})
				}
			}
		}
	}

	public detaching(): void {
		this.abortController?.abort()
		// Release the Stripe Payment Element (an <iframe> + listeners) and the
		// Elements group (holds the client-secret-bound context) so leaving the
		// route mid-flow does not leak them.
		this.paymentElement?.destroy()
		this.paymentElement = null
		this.stripeHandles = null
	}

	// ── Derived state ─────────────────────────────────────────────────────────

	/** Clamp-validated: true iff the picked count is an integer in 1..max. */
	public get isCountValid(): boolean {
		return (
			Number.isInteger(this.ticketCount) &&
			this.ticketCount >= 1 &&
			this.ticketCount <= this.maxTickets
		)
	}

	/** Both 本人確認 fields non-blank; phone is a lenient digit/format check. */
	public get isIdentityValid(): boolean {
		const name = this.fullName.trim()
		const phone = this.phoneNumber.trim()
		if (name.length === 0 || phone.length === 0) return false
		// Lenient: 10-11 digits after stripping common separators. The backend
		// performs the authoritative validation; this only blocks obvious typos.
		const digits = phone.replace(/[\s()+-]/g, '')
		return /^\d{10,11}$/.test(digits)
	}

	/** 総額 = per-ticket price × count, in JPY. */
	public get totalAmount(): number {
		return this.ticketPrice * this.ticketCount
	}

	/** 総額 formatted for display on the 特商法 confirmation screen (e.g. "¥12,000"). */
	public get totalAmountLabel(): string {
		return formatJpy(this.totalAmount)
	}

	/** Per-ticket price formatted (e.g. "¥1,200"). */
	public get ticketPriceLabel(): string {
		return formatJpy(this.ticketPrice)
	}

	// ── Step transitions ──────────────────────────────────────────────────────

	/**
	 * From the `verify-required` gate: route the fan to Settings, where the
	 * identity-verification entry point lives (the Stamp redirect leaves the app
	 * for the PocketSign app, so the flow cannot complete inline here). After
	 * verifying they re-open the apply flow.
	 */
	public async goToVerify(): Promise<void> {
		await this.router.load('/settings')
	}

	public toIdentity(): void {
		if (!this.isCountValid) {
			this.error = 'チケット枚数を確認してください。'
			return
		}
		this.error = ''
		this.step = 'identity'
	}

	public backToCount(): void {
		this.error = ''
		this.step = 'count'
	}

	/**
	 * Step 2 → 3: create the card authorization and mount the Payment Element.
	 * Requires a valid 本人確認. On success the template mounts the returned
	 * Elements group into `#payment-element`.
	 */
	public async toPayment(): Promise<void> {
		if (!this.isIdentityValid) {
			this.error = 'お名前と電話番号を正しく入力してください。'
			return
		}
		// Re-entrancy guard: a double-tap (common on mobile) must not create two
		// PaymentIntents — that would place two holds on the fan's card, one of
		// which is then orphaned. The flag is set synchronously before any await.
		if (this.authorizing) return
		this.authorizing = true
		this.error = ''
		try {
			const draft = await this.lottery.createAuthorization(
				this.phaseId,
				this.ticketCount,
				this.abortController?.signal,
			)
			this.paymentIntentRef = draft.paymentIntentRef
			this.stripeHandles = await this.stripe.createElements(draft.clientSecret)
			if (!this.stripeHandles) {
				this.error =
					'決済の初期化に失敗しました。時間をおいて再度お試しください。'
				return
			}
			// Flip the step so the template renders the mount host, then mount the
			// Payment Element into it on the next microtask (the `ref` node only
			// exists once `step === 'payment'` is in the DOM).
			this.step = 'payment'
			queueMicrotask(() => this.mountPaymentElement())
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('createAuthorization failed', { error: err })
				this.error = 'カード認証の準備に失敗しました。もう一度お試しください。'
			}
		} finally {
			this.authorizing = false
		}
	}

	/**
	 * Mounts a Stripe Payment Element into the `ref`-captured host. The Payment
	 * Element only exposes the accepted card brands (Amex is excluded at the
	 * server + surfaced in the accepted-brands notice; task 6.3). Idempotent —
	 * safe if the microtask fires after the node is already populated.
	 */
	private mountPaymentElement(): void {
		// The route may have detached during the awaits that preceded this
		// microtask; mounting into a now-detached host would leak an <iframe> that
		// detaching() already ran too early to destroy. Bail if aborted.
		if (this.abortController?.signal.aborted) return
		if (!this.stripeHandles || !this.paymentElementHost) return
		if (this.paymentElementHost.childElementCount > 0) return
		this.paymentElement = this.stripeHandles.elements.create('payment')
		this.paymentElement.mount(this.paymentElementHost)
	}

	/**
	 * Step 3 → submit: confirm the card authorization (3DS if required) then
	 * Apply with the confirmed PaymentIntent ref + 本人確認. This is the final
	 * 特商法-confirmed action; the card is authorized now and only charged on a
	 * win.
	 */
	public async confirmAndApply(): Promise<void> {
		if (!this.stripeHandles) {
			this.error = '決済フォームが読み込まれていません。'
			return
		}
		// In-flight guard: the submit button is disabled while submitting, but
		// guard here too so a stray second call cannot run concurrently.
		if (this.step === 'submitting') return
		this.error = ''
		this.step = 'submitting'

		// Confirm the card exactly once. After a successful confirm the card is
		// held (requires_capture); if Apply then fails, a retry must re-submit
		// Apply with the SAME confirmed authorization — re-confirming an already
		// requires_capture PaymentIntent is rejected by Stripe and would strand
		// the fan with a held card and no way to complete the application.
		if (!this.confirmedRef) {
			const { stripe, elements } = this.stripeHandles
			const confirm = await this.stripe.confirmAuthorization(stripe, elements)
			if (confirm.errorMessage || !confirm.paymentIntentId) {
				this.error = confirm.errorMessage ?? 'カード認証に失敗しました。'
				this.step = 'payment'
				return
			}
			this.confirmedRef = confirm.paymentIntentId
		}

		const identity: ApplicantIdentityInput = {
			fullName: this.fullName.trim(),
			phoneNumber: this.phoneNumber.trim(),
		}

		try {
			await this.lottery.apply(
				this.phaseId,
				this.ticketCount,
				identity,
				this.confirmedRef,
				this.abortController?.signal,
			)
			this.step = 'done'
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('apply failed', { error: err })
				// The card authorization is already held; retrying re-submits Apply
				// with it (it does NOT re-confirm the card).
				this.error =
					'申し込みに失敗しました。もう一度お試しください（カードの与信枠は保持されています）。'
				this.step = 'payment'
			}
		}
	}
}
