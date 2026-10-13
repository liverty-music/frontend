import { bindable } from 'aurelia'

/**
 * M3 list item. With `href` it is a single-action item: the whole item is
 * one link that opens its detail, with nothing else to press inside it
 * (M3 Lists). Without `href` it holds content only, and its trailing slot
 * may hold the item's actions (a copy button, an overflow menu): a
 * multi-action item.
 *
 * Slots: the headline (default), `overline` above it, `supporting` lines
 * below it (each slotted element is one line) and `trailing` text, status or
 * actions at the inline end. Place each item in an `<li>` of a `<ul>`.
 */
export class ListItem {
	@bindable public href = ''
}
