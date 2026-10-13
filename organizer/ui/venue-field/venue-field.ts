import { BindingMode, bindable, ILogger, resolve } from 'aurelia'
import type { FieldError } from '../../i18n/field-error'
import {
	type FieldErrorText,
	fieldErrorOf,
} from '../console-field/console-field'

/** A place picked from the map catalog. */
export interface VenuePick {
	placeId: string
	name: string
	address: string
}

export type VenueSearch = (text: string) => Promise<VenuePick[]>

export type VenueSearchState =
	| 'idle'
	| 'searching'
	| 'results'
	| 'none'
	| 'unavailable'

/** The catalog search accepts 2-100 characters after trimming. */
export const MIN_SEARCH_LENGTH = 2
export const MAX_SEARCH_LENGTH = 100

let nextId = 0

/**
 * Finds an event's venue in the map catalog: the operator types a name,
 * searches (button or Enter, not on every keystroke) and picks one of up to 5
 * places. The field never asks for a place id, and a typed name is not a
 * venue: `value` is set only by a pick.
 */
export class VenueField {
	private readonly logger = resolve(ILogger).scopeTo('VenueField')

	@bindable public label = ''
	@bindable({ mode: BindingMode.twoWay }) public value: VenuePick | null = null
	@bindable public search: VenueSearch | undefined
	/** Catalog key of the error, or a key with its values; empty when valid. */
	@bindable public error: FieldErrorText = ''
	@bindable public required = false

	public readonly inputId = `venue-field-${nextId++}`
	public query = ''
	public state: VenueSearchState = 'idle'
	public candidates: VenuePick[] = []
	public input!: HTMLInputElement

	public get canSearch(): boolean {
		const length = this.query.trim().length
		return (
			this.state !== 'searching' &&
			length >= MIN_SEARCH_LENGTH &&
			length <= MAX_SEARCH_LENGTH
		)
	}

	public get errorText(): FieldError | null {
		return fieldErrorOf(this.error)
	}

	public get describedBy(): string | null {
		const ids = [
			`${this.inputId}-status`,
			this.error ? `${this.inputId}-error` : '',
		]
		return ids.filter(Boolean).join(' ')
	}

	public async runSearch(): Promise<void> {
		if (!this.canSearch || !this.search) return
		this.state = 'searching'
		this.candidates = []
		try {
			const found = await this.search(this.query.trim())
			this.candidates = found.slice(0, 5)
			this.state = this.candidates.length > 0 ? 'results' : 'none'
		} catch (err) {
			this.logger.warn('Venue search failed', err)
			this.state = 'unavailable'
		}
	}

	public onKeydown(event: KeyboardEvent): boolean {
		if (event.key === 'Enter') {
			void this.runSearch()
			return false
		}
		return true
	}

	public pick(candidate: VenuePick): void {
		this.value = candidate
		this.query = candidate.name
		this.candidates = []
		this.state = 'idle'
	}

	/** Back to searching: the picked place is dropped until a new pick. */
	public change(): void {
		this.value = null
		this.state = 'idle'
		queueMicrotask(() => this.input?.focus())
	}

	public focus(): void {
		this.input?.focus()
	}
}
