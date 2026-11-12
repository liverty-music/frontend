import { I18N } from '@aurelia/i18n'
import { CustomElement } from 'aurelia'
import { expect } from 'storybook/test'
import { composite, contrast, resolveColor, WCAG_AA } from './contrast'
import { atWidth } from './viewport'

/**
 * Shared assertions for the fan app's persistent bottom banners (the install
 * banner and the signup prompt), which must look alike: one dark surface with a
 * brand line, the navigation bar's offset, one row of message and filled
 * compact button, one message style and one motion.
 */

const SURFACE = 'oklch(from var(--md-sys-color-surface) l c h / 85%)'

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
export async function expectBannerOffset(surface: HTMLElement): Promise<void> {
	await expect(Number.parseFloat(getComputedStyle(surface).bottom)).toBe(
		resolveLength(surface, 'var(--bottom-nav-height)'),
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
 * 4.5:1 or more) at the compact size (`data-size="compact"`, the Material 3
 * extra-small button): 32px tall with a 48px tap target, the shared 12px
 * radius and the default button's label (label-large). The message keeps its
 * own size, between 12px and 16px.
 */
export async function expectCompactFilledButton(
	action: HTMLElement,
	message: HTMLElement,
): Promise<void> {
	const style = getComputedStyle(action)
	await expect(action.hasAttribute('data-variant')).toBe(false)
	await expect(style.backgroundColor).toBe(
		resolveColor(action, 'var(--md-sys-color-primary)'),
	)
	await expect(style.color).toBe(resolveColor(action, 'var(--color-white)'))
	await expect(
		contrast(composite(style.backgroundColor), composite(style.color)),
	).toBeGreaterThanOrEqual(WCAG_AA)
	await expect(action.dataset.size).toBe('compact')
	await expect(action.getBoundingClientRect().height).toBe(32)
	await expect(
		Number.parseFloat(getComputedStyle(action, '::after').height),
	).toBe(48)
	await expect(style.borderTopLeftRadius).toBe('12px')
	// The shared buttons' one label (ui-primitives).
	const label = defaultButtonLabel(action.parentElement ?? action)
	await expect(style.fontWeight).toBe(label.weight)
	await expect(Number.parseFloat(style.fontSize)).toBe(label.size)
	const size = Number.parseFloat(getComputedStyle(message).fontSize)
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
		resolveColor(message, 'var(--md-sys-color-on-surface)'),
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

/** The cue's animations on the banner: the line's (`::before`) and the CTA's (its own background). */
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
			[action, null],
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

/** The label size and weight of a default text button, measured beside `near`. */
export function defaultButtonLabel(near: Element): {
	size: number
	weight: string
} {
	const probe = document.createElement('button')
	probe.className = 'button'
	probe.textContent = 'OK'
	near.append(probe)
	const style = getComputedStyle(probe)
	const label = {
		size: Number.parseFloat(style.fontSize),
		weight: style.fontWeight,
	}
	probe.remove()
	return label
}

/**
 * The message and the action each fit on one line with nothing clipped, side
 * by side: the message at a size between 12px and 16px that follows the
 * banner's full width (4.2 %, not its padded content box), the label at the
 * compact button's label-large (14px, the Material 3 extra-small button).
 * Measured once the web fonts are in: the button label's fallback font is
 * wider than Noto Sans JP.
 */
export async function expectFitsOneLine(
	message: HTMLElement,
	action: HTMLElement,
): Promise<void> {
	await document.fonts.ready
	const read = (el: HTMLElement) => {
		const rect = el.getBoundingClientRect()
		const range = document.createRange()
		range.selectNodeContents(el)
		return {
			clipped: el.scrollWidth > el.clientWidth,
			lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
				.size,
			fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
			left: rect.left,
			right: rect.right,
			middle: rect.top + rect.height / 2,
		}
	}
	const m = read(message)
	const a = read(action)
	for (const part of [m, a]) {
		await expect(part.clipped).toBe(false)
		await expect(part.lines).toBe(1)
	}
	await expect(a.left).toBeGreaterThanOrEqual(m.right)
	await expect(Math.abs(a.middle - m.middle)).toBeLessThan(0.5)
	await expect(a.fontSize).toBe(14)
	await expect(m.fontSize).toBeGreaterThanOrEqual(12)
	await expect(m.fontSize).toBeLessThanOrEqual(16)
	await expect(
		Math.abs(m.fontSize - Math.min(16, Math.max(12, innerWidth * 0.042))),
	).toBeLessThan(0.05)
}

/**
 * Runs `check` at each phone width in each language, then puts the language
 * back. `host` is any element of the story's app, which holds its translator.
 */
export async function atEveryPhoneWidthAndLanguage(
	host: HTMLElement,
	check: (language: 'ja' | 'en') => Promise<void>,
): Promise<void> {
	const i18n = CustomElement.for(host).container.get(I18N)
	const original = i18n.getLocale()
	try {
		for (const width of [320, 360, 375, 412]) {
			for (const language of ['ja', 'en'] as const) {
				await atWidth(width, async () => {
					await i18n.setLocale(language)
					await new Promise((r) =>
						requestAnimationFrame(() => requestAnimationFrame(r)),
					)
					await check(language)
				})
			}
		}
	} finally {
		await i18n.setLocale(original)
	}
}
