import { bindable } from 'aurelia'

/**
 * One row of a fan list, in the Material 3 list item layout: an optional
 * leading icon, the label (with an optional line of supporting text), an
 * optional trailing value and an optional caret.
 *
 * The whole row is one target: a link when `href` is set, otherwise a button.
 * A tap reaches the parent as the button's `click`, which bubbles to the host
 * (`<list-item click.trigger="...">`).
 */
export class ListItem {
	/** `svg-icon` name of the leading icon; empty for none. */
	@bindable public icon = ''
	@bindable public label = ''
	/** A second line below the label; empty for a one-line row. */
	@bindable public supporting = ''
	/** The current value, at the trailing edge. */
	@bindable public value = ''
	/** A chevron at the trailing edge: the row opens something. */
	@bindable public caret = false
	/** With an address, the row is a link to it. */
	@bindable public href = ''
	@bindable public testId = ''
}
