import { bindable } from 'aurelia'
import type { ConsoleIconName } from '../console-icon/console-icon'

/**
 * M3 extended FAB: the most important action of a screen (公演をつくる), an
 * icon and its label in a 56 px container at the bottom trailing corner of
 * the window, above the navigation bar on a phone. The label is slotted.
 * With `href` it is a link; without it, a button whose click the page
 * handles with `click.trigger`.
 */
export class ExtendedFab {
	@bindable public icon: ConsoleIconName = 'add'
	@bindable public href = ''
}
