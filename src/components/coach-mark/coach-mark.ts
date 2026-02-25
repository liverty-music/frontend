import { bindable, ILogger, resolve } from 'aurelia'

const MAX_RETRY_MS = 5000
const INITIAL_RETRY_MS = 100

export class CoachMark {
	@bindable public targetSelector = ''
	@bindable public message = ''
	@bindable public active = false
	@bindable public onTap?: () => void

	public visible = false

	private spotlightEl!: HTMLElement
	private tooltipEl!: HTMLElement
	private retryTimer: ReturnType<typeof setTimeout> | null = null
	private resizeObserver: ResizeObserver | null = null

	private readonly logger = resolve(ILogger).scopeTo('CoachMark')

	public activeChanged(): void {
		if (this.active) {
			this.findAndHighlight()
		} else {
			this.hide()
		}
	}

	public bound(): void {
		if (this.active) {
			this.findAndHighlight()
		}
	}

	public detaching(): void {
		this.cleanup()
	}

	private findAndHighlight(elapsed = 0): void {
		const target = document.querySelector(this.targetSelector)
		if (target instanceof HTMLElement) {
			this.highlight(target)
			return
		}

		if (elapsed >= MAX_RETRY_MS) {
			this.logger.error('Coach mark target not found after retries', {
				selector: this.targetSelector,
			})
			this.visible = false
			return
		}

		// Exponential backoff: 100, 200, 400, 800, 1600...
		const delay = Math.min(
			INITIAL_RETRY_MS * 2 ** Math.floor(elapsed / INITIAL_RETRY_MS),
			MAX_RETRY_MS - elapsed,
		)
		this.retryTimer = setTimeout(() => {
			this.findAndHighlight(elapsed + delay)
		}, delay)
	}

	private highlight(target: HTMLElement): void {
		this.visible = true

		// Position the spotlight and tooltip after render
		requestAnimationFrame(() => {
			this.updatePosition(target)
		})

		// Track layout changes
		this.resizeObserver = new ResizeObserver(() => {
			this.updatePosition(target)
		})
		this.resizeObserver.observe(target)
	}

	private updatePosition(target: HTMLElement): void {
		const rect = target.getBoundingClientRect()
		const padding = 8

		if (this.spotlightEl) {
			this.spotlightEl.style.top = `${rect.top - padding}px`
			this.spotlightEl.style.left = `${rect.left - padding}px`
			this.spotlightEl.style.width = `${rect.width + padding * 2}px`
			this.spotlightEl.style.height = `${rect.height + padding * 2}px`
		}

		if (this.tooltipEl) {
			// Position tooltip below the target
			const tooltipTop = rect.bottom + 16
			const tooltipLeft = Math.max(
				16,
				rect.left + rect.width / 2 - this.tooltipEl.offsetWidth / 2,
			)
			this.tooltipEl.style.top = `${tooltipTop}px`
			this.tooltipEl.style.left = `${tooltipLeft}px`
		}
	}

	public onOverlayClick(event: MouseEvent): void {
		const target = document.querySelector(this.targetSelector)
		if (target instanceof HTMLElement) {
			const rect = target.getBoundingClientRect()
			const x = event.clientX
			const y = event.clientY
			const padding = 8

			// Check if click is inside the spotlight area
			if (
				x >= rect.left - padding &&
				x <= rect.right + padding &&
				y >= rect.top - padding &&
				y <= rect.bottom + padding
			) {
				// Forward click to the target element
				target.click()
				this.onTap?.()
				return
			}
		}

		// Block clicks outside the spotlight
		event.stopPropagation()
	}

	private hide(): void {
		this.visible = false
		this.cleanup()
	}

	private cleanup(): void {
		if (this.retryTimer) {
			clearTimeout(this.retryTimer)
			this.retryTimer = null
		}
		if (this.resizeObserver) {
			this.resizeObserver.disconnect()
			this.resizeObserver = null
		}
	}
}
