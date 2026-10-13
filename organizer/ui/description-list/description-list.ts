import { bindable } from 'aurelia'

export interface Description {
	term: string
	/** Shown as is; an empty value shows `empty-label`. */
	value: string
}

/** Read-only term / value pairs (business details, a concert's summary). */
export class DescriptionList {
	@bindable public items: Description[] = []
	@bindable public emptyLabel = '—'
}
