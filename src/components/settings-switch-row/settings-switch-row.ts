import { bindable } from 'aurelia'

/**
 * A Settings row that is a switch as a whole: an icon, the label, an optional
 * description under it, and the on/off track. Tapping it runs `action`; the
 * row is busy while a returned promise settles. An `unavailable` row stays in
 * the accessibility tree (`aria-disabled`, not `disabled`) and its description
 * says why.
 */
export class SettingsSwitchRow {
	@bindable public icon = ''
	@bindable public label = ''
	@bindable public description = ''
	/** Id given to the description, which the switch references. */
	@bindable public descriptionId = ''
	@bindable public checked = false
	@bindable public unavailable = false
	@bindable public action: () => unknown = () => undefined
}
