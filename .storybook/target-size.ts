import { expect } from 'storybook/test'

/**
 * Touch targets, measured the way a tap finds them: for each control, the
 * browser's hit test at the centre and just inside the middle of each edge
 * of a 48 × 48 px square centred on the control must land on that control
 * (or something inside it, or its transparent `::after`, which hit-tests as
 * the control). Edge midpoints rather than corners, because the browser
 * hit-tests a round control's rounded corners as outside it. A control
 * narrower or shorter than 48 px fails, and so does one whose edge lands on
 * a neighbour, which is the "a tap in one never activates its neighbour"
 * case of overlapping targets.
 *
 * Design-tokens "Every control is at least 48 × 48 px to touch"; Material 3
 * "Target areas" (48 × 48 dp). A label around a visually hidden input (a
 * chip, a hype dot) is the control the fan taps, so it is the one measured.
 */

const TARGET = 48
/** How far inside the square's edge each probe sits. */
const INSET = 1

/** What a fan taps: native controls, and labels standing for hidden inputs. */
export const CONTROLS =
	'button, a[href], [role="tab"], [role="button"], select, label:has(> input[type="radio"], > input[type="checkbox"])'

/** The points of the 48 px square centred on `el`, in viewport px. */
function probePoints(el: Element): Array<[number, number]> {
	const r = el.getBoundingClientRect()
	const cx = r.left + r.width / 2
	const cy = r.top + r.height / 2
	const half = TARGET / 2 - INSET
	return [
		[cx, cy],
		[cx - half, cy],
		[cx + half, cy],
		[cx, cy - half],
		[cx, cy + half],
	]
}

/** The control a tap at (x, y) reaches, or null. */
function tapped(x: number, y: number, controls: Element[]): Element | null {
	const hit = document.elementFromPoint(x, y)
	if (!hit) return null
	return controls.find((c) => c === hit || c.contains(hit)) ?? hit
}

/**
 * Every control under `root` matching `selector` takes a tap anywhere in a
 * 48 × 48 px square centred on it, and no neighbour takes it instead. The
 * controls must be in the viewport (a story scrolls them in first).
 */
export function expectTargets(
	root: ParentNode,
	selector: string = CONTROLS,
): void {
	const controls = [...root.querySelectorAll(selector)].filter(
		(el) => el.getClientRects().length > 0,
	)
	expect(controls.length, `no control matches ${selector}`).toBeGreaterThan(0)
	for (const control of controls) {
		const name =
			control.getAttribute('aria-label') ??
			control.textContent?.trim().slice(0, 30) ??
			control.tagName
		for (const [x, y] of probePoints(control)) {
			const reached = tapped(x, y, controls)
			expect(
				reached === control,
				`a tap at (${Math.round(x)}, ${Math.round(y)}) for "${name}" reached ${reached ? (reached.getAttribute('aria-label') ?? reached.tagName) : 'nothing'}`,
			).toBe(true)
		}
	}
}
