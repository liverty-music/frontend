import { bindable, customAttribute, INode, resolve } from 'aurelia'

/**
 * Fires a callback after a 500ms press on touch devices.
 * On pointer-coarse devices only — desktop receives no behaviour.
 *
 * Usage: <tr long-press.bind="() => openUnfollowSheet(artist)">
 */
@customAttribute('long-press')
export class LongPressCustomAttribute {
	@bindable() public value: (() => void) | null = null

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	private isTouch = false
	private timer: ReturnType<typeof setTimeout> | null = null
	private startX = 0
	private startY = 0

	private readonly onPointerDown = (e: PointerEvent): void => {
		this.startX = e.clientX
		this.startY = e.clientY
		this.timer = setTimeout(() => {
			this.timer = null
			this.value?.()
		}, 500)
	}

	private readonly onPointerMove = (e: PointerEvent): void => {
		if (this.timer === null) return
		const dx = Math.abs(e.clientX - this.startX)
		const dy = Math.abs(e.clientY - this.startY)
		if (dx + dy > 10) {
			this.cancel()
		}
	}

	private readonly onPointerUp = (): void => {
		this.cancel()
	}

	private readonly onPointerCancel = (): void => {
		this.cancel()
	}

	public attached(): void {
		this.isTouch = window.matchMedia('(pointer: coarse)').matches
		if (!this.isTouch) return

		this.element.addEventListener('pointerdown', this.onPointerDown)
		this.element.addEventListener('pointermove', this.onPointerMove)
		this.element.addEventListener('pointerup', this.onPointerUp)
		this.element.addEventListener('pointercancel', this.onPointerCancel)
	}

	public detaching(): void {
		this.cancel()
		if (!this.isTouch) return

		this.element.removeEventListener('pointerdown', this.onPointerDown)
		this.element.removeEventListener('pointermove', this.onPointerMove)
		this.element.removeEventListener('pointerup', this.onPointerUp)
		this.element.removeEventListener('pointercancel', this.onPointerCancel)
	}

	private cancel(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer)
			this.timer = null
		}
	}
}
