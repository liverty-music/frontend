import { bindable } from 'aurelia'
import type { ConsoleIconName } from '../console-icon/console-icon'

/**
 * M3 standard icon button: a 24 px icon on a 48 × 48 px target. `label` is
 * its accessible name and tooltip.
 */
export class IconButton {
	@bindable public icon: ConsoleIconName = 'more-vert'
	@bindable public label = ''
	@bindable public disabled = false
	@bindable public pressed: boolean | undefined
}
