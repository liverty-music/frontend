import { expect } from 'storybook/test'
import { composite, contrast, resolveColor, WCAG_AA } from './contrast'

/**
 * Shared assertions for the fan app's persistent bottom banners (the install
 * banner and the signup prompt), which must look alike: one dark surface with a
 * brand line, the navigation bar's offset, one message style and one motion.
 */

const SURFACE = 'oklch(from var(--color-surface-base) l c h / 85%)'

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

/**
 * Motion: the banner slides and fades in over the medium motion duration, and
 * its action glows three times with the snack's timing, then stays still. With
 * reduced motion neither animates.
 */
export async function expectBannerMotion(
	surface: HTMLElement,
	action: HTMLElement,
): Promise<void> {
	const surfaceStyle = getComputedStyle(surface)
	const actionStyle = getComputedStyle(action)
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
		await expect(surfaceStyle.animationName).toBe('none')
		await expect(actionStyle.animationName).toBe('none')
		await expect(action.getAnimations()).toHaveLength(0)
		return
	}
	await expect(surfaceStyle.animationName).not.toBe('none')
	await expect(surfaceStyle.animationDuration).toBe('0.35s')
	const [entrance] = surface.getAnimations()
	const [from] = (entrance.effect as KeyframeEffect).getKeyframes()
	await expect(from.opacity).toBe('0')

	await expect(actionStyle.animationName).not.toBe('none')
	await expect(actionStyle.animationDuration).toBe('1.2s')
	await expect(actionStyle.animationIterationCount).toBe('3')
	const [glow] = action.getAnimations()
	await glow.finished
	await expect(glow.playState).toBe('finished')
}
