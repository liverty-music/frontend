import { bindable } from 'aurelia'

/**
 * The launcher's glyph: an equalizer while the arc is closed, a close cross
 * while it is open, cross-faded. Inline SVG so each equalizer bar can bounce
 * on its own as the arc opens.
 */
export class FabGlyph {
	@bindable public open = false
}
