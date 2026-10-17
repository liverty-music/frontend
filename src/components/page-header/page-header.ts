import { bindable } from 'aurelia'

export class PageHeader {
	@bindable public titleKey = ''

	/**
	 * Shows the gear that opens Settings at the header's trailing end, after any
	 * projected content. The shell sets it on the four tab pages; Settings is
	 * not a tab, so this is its entry point.
	 */
	@bindable public showSettings = false
}
