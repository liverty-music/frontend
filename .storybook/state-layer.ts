import { expect, waitFor } from 'storybook/test'
import { hoverPointer, pressAndHold, releasePointer } from './gestures'

/**
 * The shared state layer (`shared/styles/state-layer.css`), checked the same
 * way in both apps: a real pointer hover, a real keyboard focus and a real
 * pointer press raise the layer (`::before`) of the content colour to the
 * Material 3 opacities, a disabled control and a bare <button> show none, and
 * nothing scales. https://m3.material.io/foundations/interaction/states/state-layers
 */
export const STATE_LAYER_SAMPLES = `
	<div style="display:flex; flex-wrap:wrap; gap:16px; padding:16px">
		<button type="button" class="state-layer" data-sample="hover"
			style="padding:12px 16px; border:1px solid currentcolor; border-radius:12px; background:transparent">Hover</button>
		<button type="button" class="state-layer" data-sample="focus"
			style="padding:12px 16px; border:1px solid currentcolor; border-radius:12px; background:transparent">Focus</button>
		<button type="button" class="state-layer" data-sample="press"
			style="padding:12px 16px; border:1px solid currentcolor; border-radius:12px; background:transparent">Press</button>
		<button type="button" class="state-layer" data-sample="disabled" disabled
			style="padding:12px 16px; border:1px solid currentcolor; border-radius:12px; background:transparent">Disabled</button>
		<button type="button" data-sample="bare"
			style="padding:12px 16px; border:1px solid currentcolor; border-radius:12px; background:transparent">Bare</button>
	</div>
`

/** Opacity of the state layer on `el`. */
export const layerOpacity = (el: Element): number =>
	Number.parseFloat(getComputedStyle(el, '::before').opacity)

function sample(root: ParentNode, name: string): HTMLElement {
	const el = root.querySelector<HTMLElement>(`[data-sample="${name}"]`)
	if (!el) throw new Error(`sample ${name} not rendered`)
	return el
}

/** Every sample at rest: no layer, the content colour, the control's corners. */
export function expectRest(root: ParentNode): void {
	for (const name of ['hover', 'focus', 'press', 'disabled']) {
		expect(layerOpacity(sample(root, name)), name).toBe(0)
	}
	const layer = getComputedStyle(sample(root, 'hover'), '::before')
	const host = getComputedStyle(sample(root, 'hover'))
	expect(layer.backgroundColor).toBe(host.color)
	expect(layer.borderTopLeftRadius).toBe('12px')
	// A bare <button> draws no layer at all.
	expect(getComputedStyle(sample(root, 'bare'), '::before').content).toBe(
		'none',
	)
}

/** A real pointer over a control raises the 8 % hover layer. */
export async function expectHover(root: ParentNode): Promise<void> {
	const el = sample(root, 'hover')
	if (!(await hoverPointer(el))) return
	await waitFor(() => expect(layerOpacity(el)).toBeCloseTo(0.08, 5))
	const disabled = sample(root, 'disabled')
	await hoverPointer(disabled)
	await waitFor(() => expect(layerOpacity(el)).toBe(0))
	expect(layerOpacity(disabled)).toBe(0)
}

/** Keyboard focus raises the 10 % focus layer. */
export async function expectKeyboardFocus(root: ParentNode): Promise<void> {
	const focus = sample(root, 'focus')
	// The focused element as the samples' own tree sees it (a shadow root
	// reports its own active element; the document reports the host).
	const active = () =>
		(focus.getRootNode() as Document | ShadowRoot).activeElement
	// Real Tab presses (the browser's own, which enter a shadow root) until
	// the sample has focus. Only while Vitest runs the story.
	if (import.meta.env.MODE !== 'test') return
	const { userEvent } = await import('vitest/browser')
	for (let i = 0; i < 20 && active() !== focus; i++) {
		await userEvent.keyboard('{Tab}')
	}
	await expect(active()).toBe(focus)
	await waitFor(() => expect(layerOpacity(focus)).toBeCloseTo(0.1, 5))
}

/** A real pointer press raises the 10 % pressed layer and scales nothing. */
export async function expectPress(
	root: ParentNode,
	selector: string,
): Promise<void> {
	const el = sample(root, 'press')
	if (!(await pressAndHold(selector))) return
	try {
		await waitFor(() => expect(layerOpacity(el)).toBeCloseTo(0.1, 5))
		expect(getComputedStyle(el).transform).toBe('none')
		expect(getComputedStyle(el).scale).toBe('none')
	} finally {
		await releasePointer()
	}
	await waitFor(() => expect(layerOpacity(el)).toBeLessThan(0.1))
}
