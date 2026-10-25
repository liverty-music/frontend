import { bindable } from 'aurelia'

/**
 * A Settings row that is itself the control: an optional icon, the label, an
 * optional current value and, unless turned off, a chevron. Tapping it runs
 * `action` (open a selector, a legal page, passkey management…).
 */
export class SettingsLinkRow {
	@bindable public icon = ''
	@bindable public label = ''
	@bindable public value = ''
	@bindable public chevron = true
	@bindable public testId = ''
	@bindable public action: () => unknown = () => undefined
}
