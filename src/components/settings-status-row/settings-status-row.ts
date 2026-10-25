import { bindable } from 'aurelia'

/**
 * A Settings row that shows a status and the action it allows: an icon and
 * the label (an email address, 本人確認) on the first line, the status badge
 * and the action on the second, and anything projected below them (a failure
 * reason, a detail line). The badge carries an icon and text, so the status
 * is not told by color alone, and is associated with the label.
 */
export class SettingsStatusRow {
	@bindable public icon = ''
	@bindable public label = ''
	@bindable public labelId = ''
	@bindable public statusId = ''
	@bindable public verified = false
	@bindable public verifiedText = ''
	@bindable public unverifiedText = ''
	@bindable public showAction = false
	@bindable public actionLabel = ''
	@bindable public actionDisabled = false
	/** Id of an element that explains the action (e.g. why it failed last). */
	@bindable public actionDescribedBy = ''
	@bindable public action: () => unknown = () => undefined
}
