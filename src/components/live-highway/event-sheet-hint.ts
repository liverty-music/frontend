import { bindable } from 'aurelia'

/**
 * A coach-style hint above the event detail sheet's actions (landing page
 * only). A coach-mark overlay cannot point into the sheet's top-layer dialog,
 * so the guidance rides inline. Placed on a `<p role="note">` with
 * `as-element`.
 */
export class EventSheetHint {
	@bindable public text = ''
}
