import { bindable } from 'aurelia'

let nextId = 0

/**
 * A Settings consent row: an icon, the label as a disclosure that opens its
 * description, and a separate switch. The disclosure and the switch are
 * siblings, because a switch must not contain another control. Tapping the
 * switch runs `action`.
 */
export class SettingsConsentRow {
	@bindable public icon = ''
	@bindable public label = ''
	@bindable public description = ''
	@bindable public checked = false
	@bindable public action: () => unknown = () => undefined

	/** The id the disclosure points to with `aria-controls`. */
	public readonly descriptionId = `consent-description-${++nextId}`

	/** Whether the description is shown. View state only. */
	public expanded = false

	public toggleExpanded(): void {
		this.expanded = !this.expanded
	}
}
