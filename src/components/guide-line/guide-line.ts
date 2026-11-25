import { ILogger, resolve, watch } from 'aurelia'
import { type GuideMoment, IGuideService } from '../../services/guide-service'

/** The i18n key of each moment's line. */
export const GUIDE_LINE_KEYS: Record<GuideMoment, string> = {
	'discovery.follow': 'guide.discoveryFollow',
	'discovery.swap': 'guide.discoverySwap',
	'concerts.filter': 'guide.concertsFilter',
	'sheet.notify': 'guide.sheetNotify',
	'myArtists.hype': 'guide.myArtistsHype',
}

/**
 * Moments whose line sits inside the target rather than next to it: the bubble
 * field fills the screen, so its line sits along the field's top edge.
 */
const INSIDE_TARGET: ReadonlySet<GuideMoment> = new Set(['discovery.follow'])

/**
 * The one line of the current guide moment, anchored next to its target
 * (guide-moment "A guide moment is a glow and one line that never blocks").
 * A manual popover, so it enters the top layer above the page and the action
 * menu without a z-index; it takes no taps. Rendered once by the app shell.
 * The concert sheet's moment renders its own line inside the sheet, so this
 * element ignores it.
 */
export class GuideLine {
	public popoverEl?: HTMLElement
	/** The key shown; set after the popover opens so the status is announced once. */
	public messageKey = ''
	public variant: 'beside' | 'inside' = 'beside'

	private readonly guide = resolve(IGuideService)
	private readonly logger = resolve(ILogger).scopeTo('GuideLine')

	public attached(): void {
		this.render(this.guide.current)
	}

	public detaching(): void {
		this.hide()
	}

	@watch((vm: GuideLine) => vm.guide.current)
	public currentChanged(id: GuideMoment | null): void {
		this.render(id)
	}

	private render(id: GuideMoment | null): void {
		if (id === null || id === 'sheet.notify') {
			this.hide()
			return
		}
		this.variant = INSIDE_TARGET.has(id) ? 'inside' : 'beside'
		this.show()
		this.messageKey = GUIDE_LINE_KEYS[id]
	}

	/** Counts shows and hides, so a late clear of the text knows it is stale. */
	private hideGeneration = 0

	private show(): void {
		this.hideGeneration++
		const el = this.popoverEl
		if (!el) return
		try {
			// Re-show so the line enters the top layer after anything already
			// there (the action menu), and sits above it.
			if (el.matches(':popover-open')) el.hidePopover()
			el.showPopover()
		} catch (err) {
			this.logger.warn('Guide line could not open', { error: err })
		}
	}

	private hide(): void {
		const generation = ++this.hideGeneration
		const el = this.popoverEl
		if (el) {
			try {
				if (el.matches(':popover-open')) el.hidePopover()
			} catch {
				// Not shown.
			}
		}
		// The words stay while the line fades out; they go once it has, so the
		// next moment's text is set afresh and announced. With motion reduced
		// there is nothing to wait for.
		const faded =
			el && typeof el.getAnimations === 'function'
				? Promise.allSettled(el.getAnimations().map((a) => a.finished))
				: Promise.resolve()
		void faded.then(() => {
			if (generation === this.hideGeneration) this.messageKey = ''
		})
	}
}
