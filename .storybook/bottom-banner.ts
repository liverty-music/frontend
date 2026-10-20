import { expect } from 'storybook/test'
import { composite, contrast, resolveColor, WCAG_AA } from './contrast'

/**
 * Shared assertions for the fan app's persistent bottom banners (the install
 * banner and the signup prompt), which must look alike: one dark surface with a
 * brand line, the navigation bar's offset, one row of message and filled
 * compact button, one message style and one motion.
 */

const SURFACE = 'oklch(from var(--color-surface-base) l c h / 85%)'

/** The attention cue's keyframes, shared by the brand line and the CTA. */
const CUE = 'banner-cue'

/** Resolves a CSS length (custom properties included) to pixels. */
function resolveLength(host: HTMLElement, value: string): number {
	const probe = document.createElement('div')
	probe.style.blockSize = value
	host.append(probe)
	const px = probe.getBoundingClientRect().height
	probe.remove()
	return px
}

/** The banner's surface: the 85% base surface, a 2px brand line, no gradient fill. */
export async function expectBannerSurface(surface: HTMLElement): Promise<void> {
	const style = getComputedStyle(surface)
	await expect(style.backgroundColor).toBe(resolveColor(surface, SURFACE))
	await expect(style.backgroundImage).toBe('none')
	await expect(style.backdropFilter).toBe('blur(12px)')
	await expect(style.borderTopWidth).toBe('2px')
	await expect(style.borderImageSource).toContain('linear-gradient')
}

/** The banner's bottom edge sits at the navigation bar's height (no safe area in tests). */
export async function expectBannerOffset(host: HTMLElement): Promise<void> {
	await expect(Number.parseFloat(getComputedStyle(host).bottom)).toBe(
		resolveLength(host, 'var(--bottom-nav-height)'),
	)
}

/**
 * One row: the message, then the action, side by side; no icon and no other
 * control in the banner.
 */
export async function expectOneRow(
	surface: HTMLElement,
	message: HTMLElement,
	action: HTMLElement,
): Promise<void> {
	const m = message.getBoundingClientRect()
	const a = action.getBoundingClientRect()
	await expect(a.left).toBeGreaterThanOrEqual(m.right)
	await expect(Math.abs(m.top + m.height / 2 - (a.top + a.height / 2))).toBe(0)
	await expect(surface.querySelectorAll('img, svg')).toHaveLength(0)
	const controls = [...surface.querySelectorAll('button, a')].filter(
		(el) => !el.closest('bottom-sheet'),
	)
	await expect(controls).toEqual([action])
}

/**
 * The action: the filled button (the `primary` role with its white label at
 * 4.5:1 or more) at the snack's compact size, 36px tall, with the shared 12px
 * radius and bold label, and the message's text size, between 12px and 16px.
 */
export async function expectCompactFilledButton(
	action: HTMLElement,
	message: HTMLElement,
): Promise<void> {
	const style = getComputedStyle(action)
	await expect(action.hasAttribute('data-variant')).toBe(false)
	await expect(style.backgroundColor).toBe(
		resolveColor(action, 'var(--md-color-primary)'),
	)
	await expect(style.color).toBe(resolveColor(action, 'var(--color-white)'))
	await expect(
		contrast(composite(style.backgroundColor), composite(style.color)),
	).toBeGreaterThanOrEqual(WCAG_AA)
	await expect(action.getBoundingClientRect().height).toBe(36)
	await expect(style.borderTopLeftRadius).toBe('12px')
	await expect(style.fontWeight).toBe('700')
	const size = Number.parseFloat(style.fontSize)
	await expect(size).toBe(Number.parseFloat(getComputedStyle(message).fontSize))
	await expect(size).toBeGreaterThanOrEqual(12)
	await expect(size).toBeLessThanOrEqual(16)
}

/**
 * The message: primary text colour at full opacity, weight 500, and 4.5:1
 * against the translucent surface over the page background and over white
 * (the worst case for content seen through it).
 */
export async function expectBannerMessage(
	message: HTMLElement,
	surface: HTMLElement,
): Promise<void> {
	const style = getComputedStyle(message)
	await expect(style.color).toBe(
		resolveColor(message, 'var(--color-text-primary)'),
	)
	await expect(style.fontWeight).toBe('500')
	await expect(style.opacity).toBe('1')
	const fill = getComputedStyle(surface).backgroundColor
	const page = getComputedStyle(document.body).backgroundColor
	for (const base of [['white', page], ['white']]) {
		await expect(
			contrast(composite(...base, fill, style.color), composite(...base, fill)),
		).toBeGreaterThanOrEqual(WCAG_AA)
	}
}

/** The cue's animations on the banner: the line's (`::before`) and the CTA's. */
function cueAnimations(surface: HTMLElement): CSSAnimation[] {
	return surface
		.getAnimations({ subtree: true })
		.filter(
			(a): a is CSSAnimation =>
				a instanceof CSSAnimation && a.animationName === CUE,
		)
}

/**
 * Motion: the banner slides and fades in over the medium motion duration, and
 * the attention cue runs along the brand line and across the CTA every 12s,
 * five times, without moving or resizing the CTA. With reduced motion neither
 * plays.
 */
export async function expectBannerMotion(
	surface: HTMLElement,
	action: HTMLElement,
): Promise<void> {
	const surfaceStyle = getComputedStyle(surface)
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
		await expect(surfaceStyle.animationName).toBe('none')
		await expect(surface.getAnimations({ subtree: true })).toHaveLength(0)
		return
	}
	await expect(surfaceStyle.animationDuration).toBe('0.35s')
	const entrance = surface
		.getAnimations()
		.find((a) => a instanceof CSSAnimation && a.animationName !== CUE)
	if (!entrance) throw new Error('no entrance animation')
	const [from] = (entrance.effect as KeyframeEffect).getKeyframes()
	await expect(from.opacity).toBe('0')

	const cue = cueAnimations(surface)
	const targets = cue.map((a) => {
		const effect = a.effect as KeyframeEffect
		return [effect.target, effect.pseudoElement]
	})
	await expect(targets).toEqual(
		expect.arrayContaining([
			[surface, '::before'],
			[action, '::before'],
		]),
	)
	for (const a of cue) {
		const timing = a.effect?.getComputedTiming()
		await expect(timing?.duration).toBe(12_000)
		await expect(timing?.iterations).toBe(5)
	}

	// The CTA keeps its box at every moment of the cue: before it, while the
	// light crosses the CTA, and once it rests.
	const box = () => action.getBoundingClientRect().toJSON()
	const rest = box()
	for (const time of [0, 600, 1200, 1800, 6000]) {
		for (const a of cue) {
			a.pause()
			a.currentTime = time
		}
		await expect(box()).toEqual(rest)
	}
	for (const a of cue) a.play()
}
