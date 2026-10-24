/** Color math over literal `oklch()` token values, so token tests need no browser. */

export interface Oklch {
	l: number
	c: number
	h: number
	alpha: number
}

export function parseOklch(text: string): Oklch {
	const m = text.match(
		/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)deg(?:\s*\/\s*([\d.]+)%)?\s*\)/,
	)
	if (!m) throw new Error(`not a literal oklch(): ${text}`)
	return {
		l: Number(m[1]) / 100,
		c: Number(m[2]),
		h: Number(m[3]),
		alpha: m[4] === undefined ? 1 : Number(m[4]) / 100,
	}
}

function toOklab({ l, c, h }: Oklch): [number, number, number] {
	const rad = (h * Math.PI) / 180
	return [l, c * Math.cos(rad), c * Math.sin(rad)]
}

/** Euclidean distance in OKLab (ΔE OK). */
export function oklabDistance(x: Oklch, y: Oklch): number {
	const [l1, a1, b1] = toOklab(x)
	const [l2, a2, b2] = toOklab(y)
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** OKLCH → linear sRGB, clipped to the sRGB gamut. */
function toLinearSrgb(color: Oklch): [number, number, number] {
	const [l, a, b] = toOklab(color)
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
	const clip = (v: number) => Math.min(1, Math.max(0, v))
	return [
		clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
		clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
		clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
	]
}

function luminance(color: Oklch): number {
	const [r, g, b] = toLinearSrgb(color)
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio. */
export function contrast(fg: Oklch, bg: Oklch): number {
	const a = luminance(fg)
	const b = luminance(bg)
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
