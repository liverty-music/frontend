import { bindable, INode, resolve } from 'aurelia'
import type { CalendarDate } from '../../adapter/rpc/client/concert-client'
import {
	type DatePresetId,
	type DateRange,
	MAX_RANGE_DAYS,
	formatDateInput,
	inclusiveDaySpan,
	parseDateInput,
	resolvePreset,
} from './date-presets'

/**
 * Date-range preset selector for the All Nearby discovery filter. Emits a
 * `range-changed` CustomEvent carrying `{ from, to }` ({@link CalendarDate}
 * pair) whenever the effective range changes. The four presets are 今週末 /
 * 7日以内 / 30日以内 / カスタム; the custom option reveals two
 * `<input type="date">` fields whose bounds are constrained so `to` can never
 * precede `from` and the span never exceeds {@link MAX_RANGE_DAYS} days.
 */
export class DatePresetSelector {
	/** The active preset. Session-only — owned by the parent route. */
	@bindable public preset: DatePresetId = 'weekend'

	/** Custom range bounds, only meaningful while `preset === 'custom'`. */
	public customFrom = ''
	public customTo = ''

	public readonly presets: DatePresetId[] = [
		'weekend',
		'week',
		'month',
		'custom',
	]
	public readonly maxRangeDays = MAX_RANGE_DAYS

	private readonly element = resolve(INode) as HTMLElement

	public bound(): void {
		// Seed the custom inputs from the current preset so switching to custom
		// starts from a sensible, already-valid range rather than blank fields.
		const seed = resolvePreset('week')
		if (seed) {
			this.customFrom = formatDateInput(seed.from)
			this.customTo = formatDateInput(seed.to)
		}
		this.emitRange()
	}

	public selectPreset(preset: DatePresetId): void {
		this.preset = preset
		this.emitRange()
	}

	/**
	 * The minimum allowed value for the `to` input: never before `from`.
	 * Bound to the `min` attribute so the native picker enforces it.
	 */
	public get toMin(): string {
		return this.customFrom
	}

	/**
	 * The maximum allowed value for the `to` input: `from` + (MAX_RANGE_DAYS - 1)
	 * days, capping the inclusive span at {@link MAX_RANGE_DAYS}.
	 */
	public get toMax(): string {
		const from = parseDateInput(this.customFrom)
		if (!from) return ''
		const d = new Date(from.year, from.month - 1, from.day)
		d.setDate(d.getDate() + (MAX_RANGE_DAYS - 1))
		return formatDateInput({
			year: d.getFullYear(),
			month: d.getMonth() + 1,
			day: d.getDate(),
		})
	}

	public onCustomFromChanged(): void {
		this.clampCustomTo()
		this.emitRange()
	}

	public onCustomToChanged(): void {
		this.clampCustomTo()
		this.emitRange()
	}

	/**
	 * Enforce `from <= to <= from + MAX_RANGE_DAYS` by snapping `to` into range.
	 * The native `min`/`max` attributes guard typed input, but a keyboard-entered
	 * out-of-range value still needs a programmatic clamp.
	 */
	private clampCustomTo(): void {
		const from = parseDateInput(this.customFrom)
		const to = parseDateInput(this.customTo)
		if (!from || !to) return
		if (inclusiveDaySpan(from, to) < 1) {
			// `to` precedes `from`: snap to `from`.
			this.customTo = this.customFrom
			return
		}
		if (inclusiveDaySpan(from, to) > MAX_RANGE_DAYS) {
			this.customTo = this.toMax
		}
	}

	/** Resolve the effective range and notify the parent, if valid. */
	private emitRange(): void {
		const range = this.resolveRange()
		if (!range) return
		this.element.dispatchEvent(
			new CustomEvent<DateRange>('range-changed', {
				detail: range,
				bubbles: true,
			}),
		)
	}

	/** The currently effective range, or `null` when the custom input is invalid. */
	private resolveRange(): DateRange | null {
		if (this.preset !== 'custom') {
			return resolvePreset(this.preset)
		}
		const from = parseDateInput(this.customFrom)
		const to = parseDateInput(this.customTo)
		if (!from || !to) return null
		const span = inclusiveDaySpan(from, to)
		if (span < 1 || span > MAX_RANGE_DAYS) return null
		return { from, to }
	}
}

export type { CalendarDate }
