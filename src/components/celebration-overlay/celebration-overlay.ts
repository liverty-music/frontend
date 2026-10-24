import { bindable, ILogger, INode, resolve } from 'aurelia'
import { IAudioEngine } from '../../services/audio-engine'
import { IHapticService } from '../../services/haptic-service'

/** Pieces in the post-signup confetti burst. */
const CONFETTI_PIECES = 40
/** Number of palette colors (`--_c1` … `--_c10` in the stylesheet). */
const CONFETTI_COLORS = 10
const CONFETTI_SHAPES = ['square', 'circle', 'strip'] as const
/** Longest wait for the fade-out's `transitionend` (the fade is 400 ms). */
const FADE_OUT_FALLBACK_MS = 600
/** Short-long-short pulse that accompanies the post-signup burst. */
const CELEBRATION_VIBRATION = [30, 40, 60]

/** One piece of the burst; the template sets each value as a custom property. */
export interface ConfettiPiece {
	shape: (typeof CONFETTI_SHAPES)[number]
	dx: string
	dy: string
	size: string
	spin: string
	duration: string
	delay: string
	color: string
}

function between(min: number, max: number): number {
	return min + Math.random() * (max - min)
}

/**
 * One burst from the centre of the screen: each piece flies out at its own
 * angle and distance, with its own size, shape, speed and spin. The values
 * are custom properties so one `@keyframes` animates every piece.
 */
export function makeConfetti(count = CONFETTI_PIECES): ConfettiPiece[] {
	return Array.from({ length: count }, (_, i) => {
		const angle = between(0, Math.PI * 2)
		const distance = between(28, 58)
		return {
			shape: CONFETTI_SHAPES[i % CONFETTI_SHAPES.length],
			dx: `${(Math.cos(angle) * distance).toFixed(1)}vmin`,
			// Pieces drift down as they fly, like paper under gravity.
			dy: `${(Math.sin(angle) * distance + between(8, 20)).toFixed(1)}vmin`,
			size: `${between(6, 13).toFixed(1)}px`,
			spin: `${Math.round(between(-900, 900))}deg`,
			duration: `${Math.round(between(1100, 1900))}ms`,
			delay: `${Math.round(between(0, 140))}ms`,
			color: `var(--_c${(i % CONFETTI_COLORS) + 1})`,
		}
	})
}

export class CelebrationOverlay {
	@bindable public active = false
	@bindable public message = ''
	@bindable public subMessage = ''
	/** Optional third line inviting the tap that dismisses the overlay. */
	@bindable public hint = ''
	/**
	 * The post-signup tier: confetti, a sound and a vibration. When false (light
	 * tier) the overlay shows its text only.
	 */
	@bindable public confetti = true
	@bindable public onOpen?: () => void
	@bindable public onDismissed?: () => void

	public visible = false
	public fadingOut = false
	/** The burst of the current showing; empty for the light tier and reduced motion. */
	public pieces: ConfettiPiece[] = []

	public get overlayState(): 'hidden' | 'active' | 'exiting' {
		if (!this.visible) return 'hidden'
		return this.fadingOut ? 'exiting' : 'active'
	}

	private shown = false
	private fadeOutTimer: ReturnType<typeof setTimeout> | null = null

	private readonly logger = resolve(ILogger).scopeTo('CelebrationOverlay')
	private readonly host = resolve(INode) as HTMLElement
	private readonly audio = resolve(IAudioEngine)
	private readonly haptic = resolve(IHapticService)

	public activeChanged(): void {
		if (this.active && !this.shown) {
			this.show()
		}
	}

	public attached(): void {
		this.host.addEventListener('transitionend', this.onTransitionEnd)
		// Handle case where active was already true during bind() phase
		if (this.active && !this.shown) {
			this.show()
		}
	}

	public detaching(): void {
		this.host.removeEventListener('transitionend', this.onTransitionEnd)
		this.clearFadeOutTimer()
		if (this.fadingOut) {
			this.fadingOut = false
			this.onDismissed?.()
		}
	}

	/** Tap anywhere on the overlay to dismiss it. */
	public onTap(): void {
		if (!this.visible || this.fadingOut) return
		this.startFadeOut()
	}

	private show(): void {
		this.shown = true
		this.visible = true
		this.fadingOut = false
		if (this.confetti) this.celebrate()
		this.logger.info('Celebration overlay shown')
		// Notify caller on open (e.g. to advance onboarding step)
		this.onOpen?.()
	}

	/**
	 * Post-signup effects. Reduced motion drops the confetti and the vibration;
	 * the sound follows the app's mute setting. The browser allows sound and
	 * vibration only once the fan has interacted with the page, so a fan who
	 * lands here straight from the sign-up redirect sees the burst alone.
	 */
	private celebrate(): void {
		const reduced = this.prefersReducedMotion()
		this.pieces = reduced ? [] : makeConfetti()
		if (!this.hasUserActivation()) return
		this.audio.unlock()
		this.audio.playCelebration()
		if (!reduced) this.haptic.pulse(CELEBRATION_VIBRATION)
	}

	private startFadeOut(): void {
		if (this.prefersReducedMotion()) {
			this.visible = false
			this.onDismissed?.()
			return
		}

		this.fadingOut = true
		// The opacity transition's transitionend finishes the dismissal. A
		// browser that skips the transition (a background tab, a page that is
		// not rendering) never sends it, so a timer finishes it instead and the
		// invisible overlay cannot stay over the page catching taps.
		this.fadeOutTimer = setTimeout(
			() => this.finishFadeOut(),
			FADE_OUT_FALLBACK_MS,
		)
	}

	private readonly onTransitionEnd = (e: TransitionEvent): void => {
		if (e.propertyName !== 'opacity') return
		this.finishFadeOut()
	}

	private finishFadeOut(): void {
		this.clearFadeOutTimer()
		if (!this.fadingOut) return
		this.visible = false
		this.fadingOut = false
		this.onDismissed?.()
	}

	private clearFadeOutTimer(): void {
		if (this.fadeOutTimer === null) return
		clearTimeout(this.fadeOutTimer)
		this.fadeOutTimer = null
	}

	private prefersReducedMotion(): boolean {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches
	}

	/** Where the browser does not report activation, assume the fan has tapped. */
	private hasUserActivation(): boolean {
		return navigator.userActivation?.hasBeenActive ?? true
	}
}
