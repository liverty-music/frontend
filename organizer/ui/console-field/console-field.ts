import { BindingMode, bindable, INode, resolve } from 'aurelia'
import type { FieldError } from '../../i18n/field-error'

export type ConsoleFieldType =
	| 'text'
	| 'textarea'
	| 'number'
	| 'select'
	| 'datetime-local'
	| 'date'
	| 'time'
	| 'yen'

/** A choice of a select: its value and the catalog key of its label. */
export interface FieldOption {
	value: string
	labelKey: string
}

/** A field error as a catalog key, or a key with its values. */
export type FieldErrorText = string | FieldError | null | undefined

/** The error as a key and values, or null when there is none. */
export function fieldErrorOf(error: FieldErrorText): FieldError | null {
	if (!error) return null
	return typeof error === 'string' ? { key: error } : error
}

let nextId = 0

/** Detail of the `change` event a console field dispatches. */
export interface FieldChange {
	value: string
}

/**
 * M3 outlined text field (and select) with its label and a supporting line
 * under the field; an error replaces the supporting line and puts the error
 * icon at the field's trailing edge. A field error is shown here and nowhere else: it never goes to
 * the snackbar. The error and the option labels are catalog
 * keys, translated in the field's template. Date and time fields say JST: their values are
 * read as Japan time by the screen (`parseJstDateTimeLocal`).
 *
 * The control and its label live in the field's shadow root. A screen reads
 * the value through `value` or, when the operator commits a change, through
 * the field's own `change` event (`$event.detail.value`): the control's native
 * `change` does not leave the shadow root.
 */
export class ConsoleField {
	private readonly host = resolve(INode) as HTMLElement

	@bindable public label = ''
	@bindable public type: ConsoleFieldType = 'text'
	@bindable({ mode: BindingMode.twoWay }) public value = ''
	/** Catalog key of the error, or a key with its values; empty when valid. */
	@bindable public error: FieldErrorText = ''
	@bindable public hint = ''
	@bindable public required = false
	@bindable public disabled = false
	/** Shown at full contrast but not editable, for a value that is fixed (a published date). */
	@bindable public readonly = false
	@bindable public options: FieldOption[] = []
	@bindable public placeholder = ''
	@bindable public name = ''
	@bindable public autocomplete = 'off'

	public readonly inputId = `console-field-${nextId++}`
	public input!: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

	public get isTime(): boolean {
		return (
			this.type === 'datetime-local' ||
			this.type === 'date' ||
			this.type === 'time'
		)
	}

	public get errorText(): FieldError | null {
		return fieldErrorOf(this.error)
	}

	public get describedBy(): string | null {
		const ids = [
			this.error
				? `${this.inputId}-error`
				: this.hint
					? `${this.inputId}-hint`
					: '',
			this.isTime ? `${this.inputId}-zone` : '',
		].filter(Boolean)
		return ids.length ? ids.join(' ') : null
	}

	/** Re-dispatches a committed change from the field itself. */
	public changed(event: Event): void {
		const control = event.target as HTMLInputElement | HTMLSelectElement
		this.host.dispatchEvent(
			new CustomEvent<FieldChange>('change', {
				bubbles: true,
				detail: { value: control.value },
			}),
		)
	}

	/** Moves focus to the field, for "focus the first error". */
	public focus(): void {
		this.input?.focus()
	}
}
