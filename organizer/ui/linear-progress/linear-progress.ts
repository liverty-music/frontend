import { bindable } from 'aurelia'

/**
 * M3 linear progress indicator, indeterminate: the one loading signal of a
 * page, a 4 px bar along the top of the page area (design D18). `label` is
 * its accessible name (読み込み中). Under reduced motion the bar stays still.
 */
export class LinearProgress {
	@bindable public label = ''
}
