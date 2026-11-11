import { bindable } from 'aurelia'
import type { Hype } from '../../entities/follow'

/**
 * One hype level of an artist row: a visually hidden radio button and the dot
 * that stands for it. It renders on `<label as-element="hype-dot-radio">`, so
 * the label stays the tap target and the table cell's grid item. The radio's
 * native `change` event bubbles from the label to the row.
 */
export class HypeDotRadio {
	/** The radio group, one per artist. */
	@bindable public group = ''
	@bindable public level: Hype = 'watch'
	/** The level's label, the radio's accessible name. */
	@bindable public text = ''
	/** Whether this is the artist's current level. */
	@bindable public active = false
}
