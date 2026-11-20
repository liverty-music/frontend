import { bindable, INode, resolve } from 'aurelia'

/**
 * Previous and next month in one capsule, stuck to the bottom of the
 * timetable's list. Placed on the list's last `<li>` with `as-element`; the
 * highway sets the `data-has-prev`, `data-has-next` and `data-moved` the
 * stylesheet hides it by, and does the jump on `month-jump`.
 */
export class MonthJump {
	/** The first day of the month each button leads to, for its label. */
	@bindable public prevMonth: Date | null = null
	@bindable public nextMonth: Date | null = null

	private readonly element = resolve(INode) as HTMLElement

	public jump(step: 1 | -1): void {
		this.element.dispatchEvent(new CustomEvent('month-jump', { detail: step }))
	}
}
