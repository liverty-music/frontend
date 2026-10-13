import { BindingMode, bindable, INode, resolve } from 'aurelia'
import type { FieldError } from '../../i18n/field-error'
import {
	type FieldChange,
	type FieldErrorText,
	fieldErrorOf,
} from '../console-field/console-field'
import { HOURS, minuteChoices, partsOf, timeOf } from './time-of-day'

let nextId = 0

/**
 * A time of day in Japan time on a 24-hour clock (design D19): an hour select
 * (00-23) and a minute select (00-55 in 5-minute steps) in one group named by
 * the label, marked JST. No AM or PM, whatever the device's clock: the
 * choices are two-digit numbers, not a locale's format. Each select is a
 * native one, so typing digits picks a choice.
 *
 * `value` is `HH:mm`, or '' while the time is unset. Choosing an hour while
 * the minute is unset sets the minute to 00; choosing the empty choice of
 * either select unsets the time. A saved minute off the 5-minute steps (data
 * from before the steps) is shown as an extra choice and kept until the
 * operator picks another: the field never changes a value by itself.
 *
 * Like `console-field`, the selects live in the shadow root; a screen reads
 * the value through `value` or the field's own `change` event
 * (`$event.detail.value`), dispatched when the operator changes the time.
 */
export class ConsoleTimeField {
	private readonly host = resolve(INode) as HTMLElement

	@bindable public label = ''
	@bindable({ mode: BindingMode.twoWay }) public value = ''
	/** Catalog key of the error, or a key with its values; empty when valid. */
	@bindable public error: FieldErrorText = ''
	@bindable public hint = ''
	@bindable public required = false
	@bindable public disabled = false
	/** Shown at full contrast but not editable, for a time that is fixed. */
	@bindable public readonly = false

	public readonly fieldId = `console-time-field-${nextId++}`
	public readonly hours = HOURS
	public hour = ''
	public minute = ''
	public hourSelect?: HTMLSelectElement
	public readonlyInput?: HTMLInputElement

	public get minutes(): readonly string[] {
		return minuteChoices(this.minute)
	}

	public get errorText(): FieldError | null {
		return fieldErrorOf(this.error)
	}

	public get describedBy(): string {
		return [
			this.hint ? `${this.fieldId}-hint` : '',
			`${this.fieldId}-zone`,
			this.error ? `${this.fieldId}-error` : '',
		]
			.filter(Boolean)
			.join(' ')
	}

	public binding(): void {
		this.show(this.value)
	}

	public valueChanged(value: string): void {
		this.show(value)
	}

	/** The operator chose an hour, or the empty choice. */
	public hourChosen(event: Event): void {
		const hour = (event.target as HTMLSelectElement).value
		if (!hour) {
			this.unset()
		} else {
			this.hour = hour
			if (!this.minute) this.minute = '00'
		}
		this.commit()
	}

	/** The operator chose a minute, or the empty choice. */
	public minuteChosen(event: Event): void {
		const minute = (event.target as HTMLSelectElement).value
		if (!minute) {
			this.unset()
		} else {
			this.minute = minute
		}
		this.commit()
	}

	/** Moves focus to the field, for "focus the first error". */
	public focus(): void {
		;(this.readonly ? this.readonlyInput : this.hourSelect)?.focus()
	}

	/** Shows `value` unless the selects already say it (a part still unset). */
	private show(value: string): void {
		if (value === timeOf(this)) return
		const parts = partsOf(value)
		this.hour = parts.hour
		this.minute = parts.minute
	}

	private unset(): void {
		this.hour = ''
		this.minute = ''
	}

	private commit(): void {
		const next = timeOf(this)
		if (next === this.value) return
		this.value = next
		this.host.dispatchEvent(
			new CustomEvent<FieldChange>('change', {
				bubbles: true,
				detail: { value: next },
			}),
		)
	}
}
