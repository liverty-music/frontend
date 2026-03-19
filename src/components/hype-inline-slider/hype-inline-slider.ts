import { BindingMode, bindable } from 'aurelia'
import type { Hype } from '../../entities/follow'

const HYPE_STOPS: readonly Hype[] = ['watch', 'home', 'nearby', 'away']

export class HypeInlineSlider {
	@bindable public artistId = ''
	@bindable public hypeColor = ''
	@bindable({ mode: BindingMode.twoWay }) public hype: Hype = 'watch'

	public readonly stops = HYPE_STOPS
}
