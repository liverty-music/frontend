import { bindable, INode, resolve } from 'aurelia'

const HYPE_STOPS = ['watch', 'home', 'nearby', 'away'] as const
export type HypeStop = (typeof HYPE_STOPS)[number]

export class HypeInlineSlider {
	@bindable public artistId = ''
	@bindable public artistColor = ''
	@bindable public hypeLevel: HypeStop = 'watch'
	@bindable public isAuthenticated = false

	public readonly stops: readonly HypeStop[] = HYPE_STOPS

	private readonly element = resolve(INode) as HTMLElement

	public selectHype(level: HypeStop): void {
		if (!this.isAuthenticated) {
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
				detail: { artistId: this.artistId, level },
			}),
		)
	}
}
