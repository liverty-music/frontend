import { bindable } from 'aurelia'
import type { ConsoleIconName } from '../console-icon/console-icon'

/**
 * M3 standard icon button (the shared `icon-button` block): a 24 px icon in a
 * 40 px round container with a 48 × 48 px target. `label` is its accessible
 * name and tooltip. A host sets --icon-button-color to give the icon another
 * colour (the copy button's check mark).
 */
export class IconButton {
	@bindable public icon: ConsoleIconName = 'more-vert'
	@bindable public label = ''
	@bindable public disabled = false
	@bindable public pressed: boolean | undefined
}
