import { I18N } from '@aurelia/i18n'
import { INode, resolve } from 'aurelia'
import type { CalendarDate } from '../../adapter/rpc/client/concert-client'
import {
	type DatePresetId,
	type DateRange,
	formatDateInput,
	formatRangeLabel,
	inclusiveDaySpan,
	MAX_RANGE_DAYS,
	matchPreset,
	parseDateInput,
	resolvePreset,
} from './date-presets'

/**
 * The `range-changed` event payload. Carries the resolved {@link CalendarDate}
 * pair the dashboard feeds to `listByLocation`, plus the display `label` the
 * date chip renders (a preset name when a preset is active, else a localized
 * range). Emitting the label alongside the range keeps the chip's copy in sync
 * with the sheet's selection without the dashboard re-deriving it.
 */
export interface RangeChangedDetail extends DateRange {
	label: string
}

/**
 * The All Nearby date-range picker, presented as a bottom sheet. It offers three
 * quick presets (今週末 / 7日以内 / 30日以内) that apply-and-close in a single tap,
 * plus an editable custom range (開始 / 終了 `<input type="date">`) that keeps the
 * sheet open while the user edits and is committed via the primary apply button.
 *
 * Emits a `range-changed` {@link RangeChangedDetail} on both preset selection and
 * custom apply. Opened by the parent through {@link open} (via `component.ref`),
 * mirroring the user-home-selector pattern.
 */
export class DateRangeSheet {
	public isOpen = false

	/** The three quick presets rendered as a chip row. */
	public readonly presets: DatePresetId[] = ['weekend', 'week', 'month']
	public readonly maxRangeDays = MAX_RANGE_DAYS

	/**
	 * The applied range — the source of truth the chip label and the seeded
	 * inputs derive from. Defaults to the "7日以内" preset so the first load has a
	 * valid, sensible window.
	 */
	private appliedRange: DateRange = resolvePreset('week') ?? {
		from: { year: 1970, month: 1, day: 1 },
		to: { year: 1970, month: 1, day: 1 },
	}

	/** Draft custom-range bounds bound to the date inputs (edited in place). */
	public draftFrom = ''
	public draftTo = ''

	private readonly element = resolve(INode) as HTMLElement
	private readonly i18n = resolve(I18N)

	public bound(): void {
		this.seedDrafts(this.appliedRange)
		// Emit the initial range so the dashboard can load before the user ever
		// opens the sheet — mirrors the old selector's bound()-time emit.
		this.emit(this.appliedRange)
	}

	public open(): void {
		// Reseed the drafts from the applied range each open so an abandoned edit
		// never lingers.
		this.seedDrafts(this.appliedRange)
		this.isOpen = true
	}

	public onSheetClosed(): void {
		this.isOpen = false
	}

	/** A preset chip applies its range and closes the sheet in one tap. */
	public selectPreset(preset: DatePresetId): void {
		const range = resolvePreset(preset)
		if (!range) return
		this.appliedRange = range
		this.seedDrafts(range)
		this.emit(range)
		this.isOpen = false
	}

	/**
	 * Whether the given preset matches the current draft — drives the active
	 * highlight so re-opening the sheet shows which preset the range came from.
	 */
	public isPresetActive(preset: DatePresetId): boolean {
		const draft = this.draftRange
		if (!draft) return false
		return matchPreset(draft) === preset
	}

	/** The minimum allowed `to` value: never before `from`. */
	public get toMin(): string {
		return this.draftFrom
	}

	/** The maximum allowed `to` value: caps the inclusive span at MAX_RANGE_DAYS. */
	public get toMax(): string {
		const from = parseDateInput(this.draftFrom)
		if (!from) return ''
		const d = new Date(from.year, from.month - 1, from.day)
		d.setDate(d.getDate() + (MAX_RANGE_DAYS - 1))
		return formatDateInput({
			year: d.getFullYear(),
			month: d.getMonth() + 1,
			day: d.getDate(),
		})
	}

	public onDraftChanged(): void {
		// Snap an out-of-range `to` (keyboard entry can bypass min/max) so the hint
		// and apply button reflect a corrected span.
		this.clampDraftTo()
	}

	/** The draft range, or null when either input is empty / malformed. */
	private get draftRange(): DateRange | null {
		const from = parseDateInput(this.draftFrom)
		const to = parseDateInput(this.draftTo)
		if (!from || !to) return null
		return { from, to }
	}

	/** Inclusive day span of the current draft, or 0 when incomplete. */
	public get draftSpan(): number {
		const draft = this.draftRange
		if (!draft) return 0
		return inclusiveDaySpan(draft.from, draft.to)
	}

	/** True when the draft is a valid, applyable range. */
	public get isDraftValid(): boolean {
		const span = this.draftSpan
		return span >= 1 && span <= MAX_RANGE_DAYS
	}

	/** Live hint under the inputs: day count when valid, an error otherwise. */
	public get hint(): string {
		const draft = this.draftRange
		if (!draft) {
			return this.i18n.tr('allNearby.dateRange.hintIncomplete')
		}
		const span = this.draftSpan
		if (span < 1) {
			return this.i18n.tr('allNearby.dateRange.hintOrder')
		}
		if (span > MAX_RANGE_DAYS) {
			return this.i18n.tr('allNearby.dateRange.hintTooLong', {
				days: MAX_RANGE_DAYS,
			})
		}
		return this.i18n.tr('allNearby.dateRange.hintSpan', { days: span })
	}

	/** Apply the edited custom range and close (blocked while invalid). */
	public applyCustom(): void {
		const draft = this.draftRange
		if (!draft || !this.isDraftValid) return
		this.appliedRange = draft
		this.emit(draft)
		this.isOpen = false
	}

	private seedDrafts(range: DateRange): void {
		this.draftFrom = formatDateInput(range.from)
		this.draftTo = formatDateInput(range.to)
	}

	/**
	 * Enforce `from <= to <= from + MAX_RANGE_DAYS` by snapping `to`. The native
	 * min/max guard typed input; a keyboard-entered out-of-range value still needs
	 * this programmatic clamp.
	 */
	private clampDraftTo(): void {
		const from = parseDateInput(this.draftFrom)
		const to = parseDateInput(this.draftTo)
		if (!from || !to) return
		const span = inclusiveDaySpan(from, to)
		if (span < 1) {
			this.draftTo = this.draftFrom
			return
		}
		if (span > MAX_RANGE_DAYS) {
			this.draftTo = this.toMax
		}
	}

	/** The chip label for a range: the preset name if it matches one, else a range. */
	private labelFor(range: DateRange): string {
		const preset = matchPreset(range)
		if (preset) {
			return this.i18n.tr(`allNearby.datePreset.${preset}`)
		}
		return formatRangeLabel(range)
	}

	private emit(range: DateRange): void {
		this.element.dispatchEvent(
			new CustomEvent<RangeChangedDetail>('range-changed', {
				detail: { ...range, label: this.labelFor(range) },
				bubbles: true,
			}),
		)
	}
}

export type { CalendarDate }
