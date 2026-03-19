import { bindable, INode, resolve } from 'aurelia'
import type { Hype } from '../../entities/follow'

const HYPE_STOPS: readonly Hype[] = ['watch', 'home', 'nearby', 'away']

export class HypeInlineSlider {
	@bindable public artistId = ''
	@bindable public hypeColor = ''
	@bindable public hype: Hype = 'watch'
	@bindable public isAuthenticated = false

	public readonly stops = HYPE_STOPS

	private readonly element = resolve(INode) as HTMLElement

	public selectHype(level: Hype, event: Event): void {
		if (!this.isAuthenticated) {
			event.preventDefault()
			this.element.dispatchEvent(
				new CustomEvent('hype-signup-prompt', {
					bubbles: true,
				}),
			)
			return
		}

		this.element.dispatchEvent(
			new CustomEvent('hype-changed', {
				bubbles: true,
				detail: { artistId: this.artistId, hype: level },
			}),
		)
	}
}
