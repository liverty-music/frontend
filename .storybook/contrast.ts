/**
 * WCAG contrast helpers for stories. axe reports text over a gradient or a
 * translucent surface as incomplete, so stories that sit on one measure the
 * ratio themselves with these.
 */

export type Rgb = [number, number, number]

export const WCAG_AA = 4.5

/** Resolves any CSS colour (relative syntax included) to what the page paints. */
export function resolveColor(host: HTMLElement, value: string): string {
	const probe = document.createElement('span')
	probe.style.color = value
	host.append(probe)
	const resolved = getComputedStyle(probe).color
	probe.remove()
	return resolved
}

/** Paints `layers` bottom-up on one sRGB pixel and reads the result back. */
export function composite(...layers: string[]): Rgb {
	const ctx = document.createElement('canvas').getContext('2d', {
		willReadFrequently: true,
	})
	if (!ctx) throw new Error('no 2d context')
	for (const color of layers) {
		ctx.fillStyle = color
		ctx.fillRect(0, 0, 1, 1)
	}
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
	return [r, g, b]
}

/** WCAG 2.x relative luminance of an 8-bit sRGB colour. */
export function luminance([r, g, b]: Rgb): number {
	const [lr, lg, lb] = [r, g, b].map((v) => {
		const c = v / 255
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

export function contrast(a: Rgb, b: Rgb) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return (hi + 0.05) / (lo + 0.05)
}
