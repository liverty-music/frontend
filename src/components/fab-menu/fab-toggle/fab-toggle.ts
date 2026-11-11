import { bindable } from 'aurelia'

/**
 * The collapsed FAB, centred in the navigation bar's notch: a disclosure
 * button for the launcher's action arc, and itself a manual popover so it
 * floats in the top layer. `fab-menu` shows, hides and focuses it through
 * `button`, and the browser toggles the arc through `popovertarget`.
 */
export class FabToggle {
	/** Whether the action arc is open: the glyph shows a close cross. */
	@bindable public open = false
	@bindable public handed = 'right'
	/** The button, handed to the launcher, which owns its top-layer state. */
	@bindable public button?: HTMLButtonElement
}
