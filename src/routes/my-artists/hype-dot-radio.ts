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

	/** The radio input, set by `ref` in the template. */
	public radio?: HTMLInputElement

	public attached(): void {
		this.follow()
	}

	public activeChanged(): void {
		this.follow()
	}

	/**
	 * Make the radio's `checked` agree with `active`, which the page owns (it
	 * is the artist's current level). A tap checks a radio natively before
	 * the page has decided; this puts `checked` back in step whenever the
	 * page's answer arrives. `checked.bind` cannot do it: it matches the group's
	 * value, and a pick the page reverts leaves that value unchanged.
	 */
	public follow(): void {
		if (this.radio) this.radio.checked = this.active
	}
}
