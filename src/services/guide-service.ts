import { DI, ILogger, observable, resolve } from 'aurelia'
import { loadGuideSeen, saveGuideSeen } from '../adapter/storage/guide-storage'
import { Events, IAnalyticsService } from '../lib/analytics/analytics-service'
import type { GuideDismissedProps, GuideMoment } from './analytics-events'
import { IAuthService } from './auth-service'
import { IBottomSheetTracker } from './bottom-sheet-tracker'
import { IOnboardingService } from './onboarding-service'
import { IPromptCoordinator } from './prompt-coordinator'

export type { GuideMoment }

/** Why a shown moment ended without the fan using its target. */
export type GuideDismissReason = GuideDismissedProps['reason']

/** A moment counts as seen once it stayed on screen this long. */
export const GUIDE_SEEN_AFTER_MS = 3000

/** The moment whose target lives inside the open concert sheet. */
const IN_SHEET_MOMENT: GuideMoment = 'sheet.notify'

export const IGuideService = DI.createInterface<IGuideService>(
	'IGuideService',
	(x) => x.singleton(GuideService),
)

export interface IGuideService extends GuideService {}

/**
 * Owns the guide moments (guide-moment surface): which one is shown, when one
 * waits behind a sheet, dialog or celebration, which ones this device has
 * seen, and their usage events. Each screen decides its own condition and
 * calls {@link request}; the `guide-target` attribute and the `guide-line`
 * element render whatever {@link current} names.
 */
export class GuideService {
	/** The moment on screen, or null. Observable: the target and the line bind to it. */
	@observable public current: GuideMoment | null = null

	/** A moment requested while a blocker was open; shown once it closes. */
	private pending: { id: GuideMoment; replay: boolean } | null = null
	/** The element the current moment points at, set by the `guide-target` attribute. */
	private targetElement: Element | null = null
	private shownAt = 0
	private seenTimer: ReturnType<typeof setTimeout> | null = null

	private readonly logger = resolve(ILogger).scopeTo('GuideService')
	private readonly analytics = resolve(IAnalyticsService)
	private readonly auth = resolve(IAuthService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly sheets = resolve(IBottomSheetTracker)
	private readonly prompts = resolve(IPromptCoordinator)

	public constructor() {
		this.sheets.onChange(() => this.blockersChanged())
		this.prompts.onChange(() => this.blockersChanged())
	}

	/**
	 * A screen's condition for `id` holds. Shows the moment unless this device
	 * has seen it, another moment is on screen, or a blocker is open; while
	 * blocked, the request waits and the moment shows once the blocker closes
	 * (unless the screen withdraws it first).
	 */
	public request(id: GuideMoment): void {
		if (loadGuideSeen(id)) return
		this.enqueue(id, false)
	}

	/** Help's 「チュートリアル」: show `id` whether or not it was seen. */
	public replay(id: GuideMoment): void {
		this.enqueue(id, true)
	}

	/**
	 * The fan used the feature of `id`: it counts as seen whether or not the
	 * moment was on screen (a fan who follows from search while the bubble
	 * field's moment waits has no need of it), and a shown moment ends.
	 */
	public acted(id: GuideMoment): void {
		saveGuideSeen(id)
		if (this.pending?.id === id) this.pending = null
		if (this.current !== id) return
		this.report(Events.GuideActed, id)
		this.end()
	}

	/**
	 * End `id` without the fan using it. It counts as seen only after
	 * {@link GUIDE_SEEN_AFTER_MS} on screen. `route_leave` also drops a request
	 * still waiting behind a blocker.
	 */
	public dismiss(id: GuideMoment, reason: GuideDismissReason): void {
		if (reason === 'route_leave' && this.pending?.id === id) {
			this.pending = null
		}
		if (this.current !== id) return
		this.report(Events.GuideDismissed, id, { reason })
		this.end()
	}

	/** The `guide-target` attribute of the current moment registers its element. */
	public setTarget(id: GuideMoment, element: Element | null): void {
		if (this.current !== id) return
		this.targetElement = element
	}

	private enqueue(id: GuideMoment, replay: boolean): void {
		if (this.current === id) return
		if (this.current !== null) {
			// The moment inside the concert sheet wins: the sheet covers the
			// screen whose moment is on, which a blocker would end anyway.
			if (id !== IN_SHEET_MOMENT) return
			this.endBlocked()
		}
		if (this.isBlocked(id)) {
			this.pending = { id, replay }
			return
		}
		this.show(id)
	}

	private show(id: GuideMoment): void {
		this.pending = null
		this.current = id
		this.shownAt = Date.now()
		this.report(Events.GuideShown, id)
		this.seenTimer = setTimeout(() => {
			this.seenTimer = null
			saveGuideSeen(id)
		}, GUIDE_SEEN_AFTER_MS)
		document.addEventListener('click', this.onOutsideClick, true)
	}

	private end(): void {
		if (this.seenTimer !== null) {
			clearTimeout(this.seenTimer)
			this.seenTimer = null
		}
		document.removeEventListener('click', this.onOutsideClick, true)
		this.targetElement = null
		this.current = null
	}

	/**
	 * A blocker opened over the shown moment. A moment that was on screen for
	 * less than {@link GUIDE_SEEN_AFTER_MS} waits and shows again once the
	 * blocker closes.
	 */
	private endBlocked(): void {
		const id = this.current
		if (id === null) return
		const seen = Date.now() - this.shownAt >= GUIDE_SEEN_AFTER_MS
		this.report(Events.GuideDismissed, id, { reason: 'blocked' })
		this.end()
		if (!seen) this.pending = { id, replay: false }
	}

	private blockersChanged(): void {
		if (this.current !== null && this.isBlocked(this.current)) {
			this.endBlocked()
			return
		}
		if (this.current === null && this.pending !== null) {
			const { id, replay } = this.pending
			if (this.isBlocked(id)) return
			if (!replay && loadGuideSeen(id)) {
				this.pending = null
				return
			}
			this.show(id)
		}
	}

	/**
	 * A sheet, the post-signup surface (celebration and dialog) or a modal
	 * dialog is open. The concert sheet's own moment ignores the one sheet it
	 * lives in.
	 */
	private isBlocked(id: GuideMoment): boolean {
		const allowedSheets = id === IN_SHEET_MOMENT ? 1 : 0
		if (this.sheets.openCount > allowedSheets) return true
		if (this.prompts.isPostSignupSurfaceOpen) return true
		return hasOpenModalDialog()
	}

	/**
	 * A tap outside the target ends the moment; the tap still reaches the page.
	 * Heard on `click`, not `pointerdown`: ending the moment removes its line,
	 * and a line inside the concert sheet would shrink the sheet between press
	 * and release, moving the control the fan is pressing so the click never
	 * lands on it.
	 */
	private readonly onOutsideClick = (e: MouseEvent): void => {
		const id = this.current
		if (id === null) return
		const target = e.target as Node | null
		if (target && this.targetElement?.contains(target)) return
		this.dismiss(id, 'other_tap')
	}

	private report(
		name: typeof Events.GuideShown | typeof Events.GuideActed,
		id: GuideMoment,
	): void
	private report(
		name: typeof Events.GuideDismissed,
		id: GuideMoment,
		extra: { reason: GuideDismissReason },
	): void
	private report(
		name:
			| typeof Events.GuideShown
			| typeof Events.GuideActed
			| typeof Events.GuideDismissed,
		id: GuideMoment,
		extra?: { reason: GuideDismissReason },
	): void {
		const props = {
			moment: id,
			is_guest: !this.auth.isAuthenticated,
			is_onboarding: this.onboarding.isOnboarding,
		}
		this.logger.debug('Guide moment', { name, ...props, ...extra })
		if (name === Events.GuideDismissed && extra) {
			this.analytics.capture(name, { ...props, ...extra })
		} else if (name !== Events.GuideDismissed) {
			this.analytics.capture(name, props)
		}
	}
}

/** Whether a modal `<dialog>` (opened with `showModal()`) is on screen. */
function hasOpenModalDialog(): boolean {
	try {
		return document.querySelector('dialog:modal') !== null
	} catch {
		// An engine without `:modal` (jsdom): any open dialog counts.
		return document.querySelector('dialog[open]') !== null
	}
}
