import { bindable } from 'aurelia'

export type StatusTone = 'success' | 'warning' | 'error' | 'neutral' | 'info'

/**
 * A status shown by color AND its text label (公開中, 下書き, 販売中, …):
 * color is never the only signal.
 */
export class StatusBadge {
	@bindable public tone: StatusTone = 'neutral'
	@bindable public label = ''
}
