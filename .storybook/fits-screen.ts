/**
 * The check every story passes after it has run: no text of the story is cut
 * off or runs past the screen's edge, and no box lies outside it. It measures
 * the story at the width it is shown at (its own `viewport` global, or the
 * browser's), so a story that frames its content at a fixed width is judged
 * against the screen that frame sits in.
 *
 * It looks at the text itself rather than at element boxes, because a label
 * wider than its box (a headline that cannot wrap) runs out of the box and
 * past the screen while every box stays inside it.
 *
 * A story that cannot pass says why: `parameters: { fitsScreen: { disable:
 * 'reason' } }`.
 */

export interface FitsScreenParameters {
	/** Why this story is exempt. Required: an empty reason is not a reason. */
	disable?: string
}

/** A box or run of text too small to see (a visually hidden label). */
function isTiny(el: Element): boolean {
	const r = el.getBoundingClientRect()
	return r.width < 2 || r.height < 2
}

/** Drawn at all: not `display: none`, hidden or fully transparent, itself or above. */
function isShown(el: Element): boolean {
	return el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
}

function describe(el: Element): string {
	const classes =
		typeof el.className === 'string'
			? el.className
					.split(/\s+/)
					.filter((c) => c && !/^[[\]]$/.test(c))
					.slice(0, 2)
			: []
	return [el.tagName.toLowerCase(), ...classes].join('.')
}

/**
 * What holds `el` sideways: the nearest element (`el` itself first when
 * `includeSelf`) whose `overflow-x` is not `visible`. It scrolls (what lies
 * beyond can be reached) or clips (what lies beyond is cut off, whatever
 * scrolls further out).
 *
 * `overflow-x: auto` alone does not say a row scrolls on purpose: the computed
 * style of a vertical-only scroller (`overflow-y: auto`, as a route's page
 * has) is the same `auto` on both axes, so it cannot be told from a sideways
 * one. A box as wide as the screen that scrolls sideways is the page scrolling
 * sideways, which is the fault this check looks for, so only a box narrower
 * than the screen counts as a row that scrolls on purpose.
 */
function holderOf(
	el: Element,
	includeSelf: boolean,
): { el: Element; scrolls: boolean } | null {
	const screenWidth = document.documentElement.clientWidth
	for (
		let p: Element | null = includeSelf ? el : el.parentElement;
		p && p !== document.body;
		p = p.parentElement
	) {
		const ox = getComputedStyle(p).overflowX
		if (ox === 'visible') continue
		const inset = p.getBoundingClientRect().width < screenWidth - 1
		return { el: p, scrolls: (ox === 'auto' || ox === 'scroll') && inset }
	}
	return null
}

/** The left and right edges of the text `el` draws itself. */
function ownTextEdges(el: Element): { left: number; right: number } | null {
	let edges: { left: number; right: number } | null = null
	for (const node of el.childNodes) {
		if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue
		const range = document.createRange()
		range.selectNodeContents(node)
		for (const r of range.getClientRects()) {
			if (r.width < 1) continue
			edges = edges
				? {
						left: Math.min(edges.left, r.left),
						right: Math.max(edges.right, r.right),
					}
				: { left: r.left, right: r.right }
		}
	}
	return edges
}

/**
 * What is cut off or past the screen's edge, one line each. Empty when the
 * story fits. Text that scrolls on purpose (its nearest `overflow-x` holder,
 * itself or above, is `auto` or `scroll`) and text shortened with an ellipsis
 * is not reported; text a holder that clips (`hidden`, `clip`) cuts off is, and
 * so is text that runs free past the screen. A box is reported when it lies
 * outside the screen unless a row that scrolls on purpose holds it.
 */
export function findOverflow(): string[] {
	const screenWidth = document.documentElement.clientWidth
	const found: string[] = []
	for (const el of document.body.querySelectorAll('*')) {
		if (el.closest('#storybook-docs, script, style, svg')) continue
		if (!isShown(el) || isTiny(el)) continue
		const cs = getComputedStyle(el)

		const text = ownTextEdges(el)
		const holder = text ? holderOf(el, true) : null
		if (text && !holder?.scrolls) {
			const holderBox = holder?.el.getBoundingClientRect()
			const pastScreen =
				!holder && (text.right > screenWidth + 1 || text.left < -1)
			const cutByHolder =
				holder &&
				holderBox &&
				(text.right > holderBox.right + 1 || text.left < holderBox.left - 1) &&
				cs.textOverflow !== 'ellipsis' &&
				getComputedStyle(holder.el).textOverflow !== 'ellipsis'
			if (pastScreen || cutByHolder) {
				const where = pastScreen
					? `past the ${screenWidth}px screen`
					: `cut off by ${describe(holder?.el ?? el)}`
				found.push(
					`${describe(el)} "${el.textContent?.trim().slice(0, 24)}" ${where} (${Math.round(text.left)}..${Math.round(text.right)})`,
				)
			}
		}

		const box = el.getBoundingClientRect()
		if (
			(box.right > screenWidth + 1 || box.left < -1) &&
			!holderOf(el, false)?.scrolls &&
			cs.position !== 'fixed' &&
			el.closest('[aria-hidden="true"]') === null
		) {
			const parent = el.parentElement?.getBoundingClientRect()
			const parentToo =
				parent && (parent.right > screenWidth + 1 || parent.left < -1)
			if (!parentToo) {
				found.push(
					`${describe(el)} box past the ${screenWidth}px screen (${Math.round(box.left)}..${Math.round(box.right)})`,
				)
			}
		}
	}
	return found
}

/**
 * Runs {@link findOverflow} after a story, only while Vitest runs it (as the
 * accessibility check fails only there), with the animations cancelled so a
 * line that is still sliding in is measured where it rests.
 */
export function expectFitsScreen(parameters: {
	fitsScreen?: FitsScreenParameters
}): void {
	if (import.meta.env.MODE !== 'test') return
	if (parameters.fitsScreen?.disable) return
	// Measure the page at rest: what its styles say with no animation or
	// transition applied. (Storybook holds animations at their start, where a
	// line that fades in is still transparent, and finishing them reads the
	// wrong end for some.)
	for (const animation of document.getAnimations()) animation.cancel()
	const found = findOverflow()
	if (found.length === 0) return
	throw new Error(
		`Something is cut off or past the screen's edge:\n${found
			.slice(0, 8)
			.map((line) => `  - ${line}`)
			.join('\n')}`,
	)
}
