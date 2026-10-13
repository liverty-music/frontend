import { BindingMode, bindable, ILogger, resolve } from 'aurelia'
import type { FieldError } from '../../i18n/field-error'
import { IVenueClient, type VenuePick } from '../../services/venue-client'
import type { ConsoleButton } from '../console-button/console-button'
import {
	type FieldErrorText,
	fieldErrorOf,
} from '../console-field/console-field'
import { MAX_SEARCH_LENGTH, searchableText } from './venue-search-rule'

export type { VenuePick } from '../../services/venue-client'
export { MAX_SEARCH_LENGTH } from './venue-search-rule'

/**
 * A search the field runs instead of `IVenueClient.search`. The field aborts
 * `signal` when the text changes before the answer arrives.
 */
export type VenueSearch = (
	text: string,
	signal?: AbortSignal,
) => Promise<VenuePick[]>

export type VenueSearchState =
	| 'idle'
	| 'searching'
	| 'results'
	| 'none'
	| 'unavailable'

/** How long the field waits after the last keystroke before it searches. */
export const SEARCH_DELAY_MS = 500
/** The catalog answers with at most 5 places. */
export const MAX_CANDIDATES = 5

let nextId = 0

/**
 * Finds an event's venue in the map catalog as the operator types (design D9):
 * 500 ms after the last keystroke, once the text is long enough
 * (`searchableText`), the field lists up to 5 places in an ARIA combobox and
 * the operator picks one with the pointer or the keyboard (arrows move, Enter
 * picks, Escape closes). Only the answer to the latest text is shown: a newer
 * keystroke aborts the request in flight and drops its late answer.
 *
 * The field never asks for a place id, and a typed name is not a venue:
 * `value` is set only by a pick. `typedNotPicked` tells the screen that text
 * was typed but nothing picked.
 */
export class VenueField {
	private readonly logger = resolve(ILogger).scopeTo('VenueField')
	private readonly venues = resolve(IVenueClient)

	@bindable public label = ''
	@bindable({ mode: BindingMode.twoWay }) public value: VenuePick | null = null
	/**
	 * Optional search to run instead of `IVenueClient.search`. Kept for screens
	 * that still pass one; without it the field calls the venue client itself.
	 */
	@bindable public search: VenueSearch | undefined
	/** Catalog key of the error, or a key with its values; empty when valid. */
	@bindable public error: FieldErrorText = ''
	@bindable public required = false
	/** True while the input holds text and no place is picked. */
	@bindable({ mode: BindingMode.fromView }) public typedNotPicked = false

	public readonly inputId = `venue-field-${nextId++}`
	public readonly listboxId = `${this.inputId}-listbox`
	public readonly maxLength = MAX_SEARCH_LENGTH
	public query = ''
	public state: VenueSearchState = 'idle'
	public candidates: VenuePick[] = []
	/** True while the list of candidates is shown. */
	public expanded = false
	/** The option the arrow keys moved to; -1 for none. */
	public activeIndex = -1
	public input?: HTMLInputElement
	public changeButton?: ConsoleButton

	private timer: ReturnType<typeof setTimeout> | null = null
	private request: AbortController | null = null
	/** Bumped by every change of the text; an answer for an older one is dropped. */
	private generation = 0

	public get errorText(): FieldError | null {
		return fieldErrorOf(this.error)
	}

	/** The hint shows until there is an error, an open list or a pick. */
	public get showHint(): boolean {
		return !this.errorText && !this.expanded && !this.value
	}

	public get describedBy(): string {
		const ids = [
			`${this.inputId}-status`,
			this.errorText ? `${this.inputId}-error` : '',
			this.showHint ? `${this.inputId}-hint` : '',
		]
		return ids.filter(Boolean).join(' ')
	}

	public get activeId(): string | null {
		return this.expanded && this.activeIndex >= 0
			? this.optionId(this.activeIndex)
			: null
	}

	public optionId(index: number): string {
		return `${this.inputId}-option-${index}`
	}

	public valueChanged(value: VenuePick | null): void {
		if (value) {
			this.cancel()
			this.close()
			this.candidates = []
			this.state = 'idle'
		}
		this.updateTypedNotPicked()
	}

	/**
	 * Every keystroke drops the current list and the answer in flight, then
	 * waits 500 ms for the next one. Text inside an unfinished IME composition
	 * is not searched; the composition's end counts as the keystroke.
	 */
	public onInput(event: Event): void {
		const target = event.target as HTMLInputElement
		this.query = target.value
		this.cancel()
		this.close()
		this.candidates = []
		this.state = 'idle'
		this.updateTypedNotPicked()
		const composing = event instanceof InputEvent && event.isComposing
		if (composing || searchableText(this.query) === null) return
		this.timer = setTimeout(() => {
			this.timer = null
			void this.runSearch()
		}, SEARCH_DELAY_MS)
	}

	/** Searches for the current text now, unless it is too short. */
	public async runSearch(): Promise<void> {
		const text = searchableText(this.query)
		this.cancel()
		if (text === null) return
		const generation = this.generation
		const request = new AbortController()
		this.request = request
		this.state = 'searching'
		this.candidates = []
		this.close()
		try {
			const found = await this.find(text, request.signal)
			if (generation !== this.generation) return
			this.candidates = found.slice(0, MAX_CANDIDATES)
			this.state = this.candidates.length > 0 ? 'results' : 'none'
			this.expanded = this.candidates.length > 0
		} catch (err) {
			// An aborted or superseded request is not a failure of the catalog.
			if (generation !== this.generation) return
			this.logger.warn('Venue search failed', err)
			this.state = 'unavailable'
		} finally {
			if (this.request === request) this.request = null
		}
	}

	/** 再試行: searches again and keeps the operator in the input. */
	public retry(): void {
		this.input?.focus()
		void this.runSearch()
	}

	public onKeydown(event: KeyboardEvent): void {
		// Enter confirms an IME conversion; it neither picks nor searches.
		if (event.isComposing) return
		const count = this.candidates.length
		switch (event.key) {
			case 'ArrowDown':
				if (count === 0) return
				event.preventDefault()
				if (!this.expanded) {
					this.expanded = true
					this.activeIndex = 0
				} else {
					this.activeIndex = (this.activeIndex + 1) % count
				}
				return
			case 'ArrowUp':
				if (count === 0) return
				event.preventDefault()
				if (!this.expanded) {
					this.expanded = true
					this.activeIndex = count - 1
				} else {
					this.activeIndex =
						this.activeIndex <= 0 ? count - 1 : this.activeIndex - 1
				}
				return
			case 'Enter':
				// Enter never submits the surrounding form from this field.
				event.preventDefault()
				if (this.expanded && this.activeIndex >= 0) {
					this.pick(this.candidates[this.activeIndex])
				} else if (this.state !== 'results' && this.state !== 'searching') {
					void this.runSearch()
				}
				return
			case 'Escape':
				if (!this.expanded) return
				// Closes the list only, not a dialog the field sits in.
				event.preventDefault()
				event.stopPropagation()
				this.close()
				return
		}
	}

	/** A press on the list must not move focus out of the input (and close it). */
	public keepFocus(event: MouseEvent): void {
		event.preventDefault()
	}

	/** Leaving the input closes the list; the candidates stay for ArrowDown. */
	public onBlur(): void {
		this.close()
	}

	public pick(candidate: VenuePick): void {
		this.cancel()
		this.query = candidate.name
		this.candidates = []
		this.state = 'idle'
		this.close()
		this.value = candidate
		this.updateTypedNotPicked()
		queueMicrotask(() => this.changeButton?.focus())
	}

	/** Back to searching: the picked place is dropped until a new pick. */
	public change(): void {
		if (this.value && !this.query) this.query = this.value.name
		this.value = null
		this.state = 'idle'
		this.updateTypedNotPicked()
		queueMicrotask(() => this.input?.focus())
	}

	public focus(): void {
		this.input?.focus()
	}

	public detaching(): void {
		this.cancel()
	}

	private find(text: string, signal: AbortSignal): Promise<VenuePick[]> {
		return this.search
			? this.search(text, signal)
			: this.venues.search(text, signal)
	}

	private close(): void {
		this.expanded = false
		this.activeIndex = -1
	}

	/** Stops the pending search and the request in flight; drops its answer. */
	private cancel(): void {
		if (this.timer !== null) clearTimeout(this.timer)
		this.timer = null
		this.request?.abort()
		this.request = null
		this.generation++
	}

	private updateTypedNotPicked(): void {
		this.typedNotPicked = this.value === null && this.query.trim() !== ''
	}
}
