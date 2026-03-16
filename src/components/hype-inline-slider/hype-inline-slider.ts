import { bindable, INode, resolve } from 'aurelia'
import { HypeType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js'

const HYPE_STOPS: readonly HypeType[] = [
	HypeType.WATCH,
	HypeType.HOME,
	HypeType.NEARBY,
	HypeType.AWAY,
]

export class HypeInlineSlider {
	@bindable public artistId = ''
	@bindable public hypeColor = ''
	@bindable public hype: HypeType = HypeType.WATCH
	@bindable public isAuthenticated = false

	public readonly stops = HYPE_STOPS

	private readonly element = resolve(INode) as HTMLElement

	public selectHype(level: HypeType, event: Event): void {
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
