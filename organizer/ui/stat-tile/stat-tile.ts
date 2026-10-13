import { bindable } from 'aurelia'

/**
 * One number with its label (応募数 412). `value` is formatted by the screen
 * (`count` or `yen`), so the tile only lays it out with tabular figures.
 */
export class StatTile {
	@bindable public label = ''
	@bindable public value = ''
	@bindable public supporting = ''
}
