import { BindingMode, bindable } from 'aurelia'

export type ConsoleFieldType =
	| 'text'
	| 'textarea'
	| 'number'
	| 'select'
	| 'datetime-local'
	| 'date'
	| 'time'
	| 'yen'

export interface FieldOption {
	value: string
	label: string
}

let nextId = 0

/**
 * M3 outlined text field (and select) with its label, a supporting line and an
 * error slot under the field. A field error is shown here and nowhere else: it
 * never goes to the snackbar. Date and time fields say JST: their values are
 * read as Japan time by the screen (`parseJstDateTimeLocal`).
 */
export class ConsoleField {
	@bindable public label = ''
	@bindable public type: ConsoleFieldType = 'text'
	@bindable({ mode: BindingMode.twoWay }) public value = ''
	@bindable public error = ''
	@bindable public hint = ''
	@bindable public required = false
	@bindable public disabled = false
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

	public get describedBy(): string | null {
		const ids = [
			this.hint ? `${this.inputId}-hint` : '',
			this.isTime ? `${this.inputId}-zone` : '',
			this.error ? `${this.inputId}-error` : '',
		].filter(Boolean)
		return ids.length ? ids.join(' ') : null
	}

	/** Moves focus to the field, for "focus the first error". */
	public focus(): void {
		this.input?.focus()
	}
}
