import { customAttribute, INode, resolve } from 'aurelia'
import {
	onReducedMotionChange,
	prefersReducedMotion,
} from '../util/prefers-reduced-motion'

/**
 * Material 3 Expressive press feedback: a contact-point ripple plus a
 * round↔squircle corner morph on `:active`, attached declaratively so it can be
 * applied app-wide (buttons, tappable cards) without per-component CSS —
 * mirroring the `busy-on-click` precedent.
 *
 * Split of concerns:
 * - The **ripple** — whose origin and size depend on the pointer coordinates —
 *   is spawned here and is the universal press acknowledgement: it is
 *   JS-driven, so it fires regardless of CSS `@layer` precedence.
 * - The **corner morph** lives in CSS (utility layer, keyed off the
 *   `data-press-feedback` attribute this sets). By cascade design it applies to
 *   controls that do NOT pin their own `:active` shape (plain buttons, the
 *   discover CTA); components that define a bespoke `:active` corner treatment
 *   in the block layer (e.g. `event-card`) keep theirs and are unaffected.
 *
 * Hit area is never animated: the ripple is painted into an absolutely
 * positioned, overflow-clipped overlay child, and only the visual corner radius
 * morphs, so the clickable bounds (and the ≥44–48px target) stay stable.
 *
 * Usage: <button press-feedback>…</button>  /  <article press-feedback> … </article>
 */
@customAttribute('press-feedback')
export class PressFeedbackCustomAttribute {
	private readonly element = resolve(INode) as HTMLElement
	private overlay: HTMLElement | null = null
	// Whether we set position:relative ourselves, so detaching() can restore it.
	private setPosition = false
	// Live-tracked reduced-motion preference (updated via subscription below), so
	// a mid-session OS toggle takes effect without remounting — using the shared
	// helper rather than a one-shot matchMedia snapshot.
	private reduceMotion = prefersReducedMotion()
	private unsubReducedMotion: (() => void) | null = null

	private readonly onPointerDown = (e: PointerEvent): void => {
		this.spawnRipple(e.clientX, e.clientY)
	}

	private readonly onKeyDown = (e: KeyboardEvent): void => {
		// Keyboard/switch activation (Enter/Space) has no pointer coordinates;
		// ripple from the element centre so non-pointer users get the same cue.
		if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
		if (e.repeat) return
		const rect = this.element.getBoundingClientRect()
		this.spawnRipple(rect.left + rect.width / 2, rect.top + rect.height / 2)
	}

	/** Paint a ripple centred on a viewport point; no-op under reduced motion. */
	private spawnRipple(clientX: number, clientY: number): void {
		// Reduced motion: skip the ripple; the CSS state-layer/opacity fallback
		// still acknowledges the press.
		if (this.reduceMotion) return

		const rect = this.element.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) return

		const x = clientX - rect.left
		const y = clientY - rect.top
		// Diameter = twice the distance to the farthest corner, so the ripple
		// always covers the element from the contact point.
		const dx = Math.max(x, rect.width - x)
		const dy = Math.max(y, rect.height - y)
		const size = 2 * Math.hypot(dx, dy)

		// Offset from the element's INLINE-START edge (inset-inline-start), which
		// is the right edge under RTL — mirror the horizontal origin so the ripple
		// starts at the real contact point in both directions.
		const rtl = getComputedStyle(this.element).direction === 'rtl'
		const inlineStart = (rtl ? rect.right - clientX : x) - size / 2

		const ripple = document.createElement('span')
		ripple.className = 'press-ripple'
		ripple.style.setProperty('--ripple-size', `${size}px`)
		ripple.style.setProperty('--ripple-x', `${inlineStart}px`)
		ripple.style.setProperty('--ripple-y', `${y - size / 2}px`)
		ripple.addEventListener('animationend', () => ripple.remove(), {
			once: true,
		})

		this.ensureOverlay().appendChild(ripple)
	}

	/** Lazily insert the clip container that holds ripples. */
	private ensureOverlay(): HTMLElement {
		if (this.overlay) return this.overlay
		const overlay = document.createElement('span')
		overlay.className = 'press-ripple-container'
		overlay.setAttribute('aria-hidden', 'true')
		this.element.appendChild(overlay)
		this.overlay = overlay
		return overlay
	}

	public attached(): void {
		this.element.setAttribute('data-press-feedback', '')
		// Establish a positioning context off the interaction hot path (once at
		// attach), without disturbing components that already set their own.
		if (getComputedStyle(this.element).position === 'static') {
			this.element.style.position = 'relative'
			this.setPosition = true
		}
		this.element.addEventListener('pointerdown', this.onPointerDown)
		this.element.addEventListener('keydown', this.onKeyDown)
		this.unsubReducedMotion = onReducedMotionChange((reduced) => {
			this.reduceMotion = reduced
		})
	}

	public detaching(): void {
		this.element.removeEventListener('pointerdown', this.onPointerDown)
		this.element.removeEventListener('keydown', this.onKeyDown)
		this.unsubReducedMotion?.()
		this.unsubReducedMotion = null
		this.overlay?.remove()
		this.overlay = null
		this.element.removeAttribute('data-press-feedback')
		// Restore the inline position we added, so a reused DOM node is left as we
		// found it.
		if (this.setPosition) {
			this.element.style.position = ''
			this.setPosition = false
		}
	}
}
