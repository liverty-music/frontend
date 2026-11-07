import { expect } from 'storybook/test'
import { page } from 'vitest/browser'

/**
 * Checks of the shared Material 3 foundations (shared/styles/m3-sys.css and
 * m3-typescale.css), run by a Foundations story in each app so that both the
 * fan app and the organizer console are verified with their own tokens.
 */

/** Markup of the type style samples, on the app's surface. */
export const TYPE_SAMPLES = `
	<div style="display:grid; gap:8px; padding:16px; background:var(--md-color-surface); color:var(--md-color-on-surface)">
		<p class="md-typescale-title-large" data-sample="title-large">Title large 公演の詳細</p>
		<p class="md-typescale-label-large" data-sample="label-large">Label large</p>
		<p class="md-typescale-label-large-emphasized" data-sample="label-large-emphasized">Label large emphasized</p>
		<p class="md-typescale-body-large" data-sample="body-large">Body large 本文</p>
	</div>
`

/** Markup of the elevation samples: two surfaces at level 2, and each level. */
export const ELEVATION_SAMPLES = `
	<div style="display:flex; flex-wrap:wrap; gap:24px; padding:24px; background:var(--md-color-surface); color:var(--md-color-on-surface)">
		<div data-level="2" data-pair style="padding:16px; background:var(--md-color-surface-container); box-shadow:var(--md-sys-elevation-level2)">Menu</div>
		<div data-level="2" data-pair style="padding:16px; background:var(--md-color-surface-container); box-shadow:var(--md-sys-elevation-level2)">Floating button</div>
		${[1, 3, 4, 5]
			.map(
				(level) =>
					`<div data-level="${level}" style="padding:16px; background:var(--md-color-surface-container); box-shadow:var(--md-sys-elevation-level${level})">Level ${level}</div>`,
			)
			.join('')}
	</div>
`

const sample = (root: ParentNode, name: string): HTMLElement => {
	const element = root.querySelector<HTMLElement>(`[data-sample="${name}"]`)
	if (!element) throw new Error(`No type sample ${name}`)
	return element
}

/** Title-large is 22 px on a 28 px line at a narrow and a wide window. */
export async function expectTitleAtAnyWidth(root: ParentNode): Promise<void> {
	try {
		for (const width of [360, 1280]) {
			await page.viewport(width, 800)
			const style = getComputedStyle(sample(root, 'title-large'))
			expect(style.fontSize, `at ${width} px`).toBe('22px')
			expect(style.lineHeight, `at ${width} px`).toBe('28px')
		}
	} finally {
		await page.viewport(1280, 800)
	}
}

/** The emphasized style has the same size and line, one weight step heavier. */
export function expectEmphasizedOneStepHeavier(root: ParentNode): void {
	const regular = getComputedStyle(sample(root, 'label-large'))
	const emphasized = getComputedStyle(sample(root, 'label-large-emphasized'))
	expect(emphasized.fontSize).toBe(regular.fontSize)
	expect(emphasized.lineHeight).toBe(regular.lineHeight)
	expect(regular.fontWeight).toBe('500')
	expect(emphasized.fontWeight).toBe('600')
}

/**
 * Body-large follows the browser's default text size. The browser setting
 * sets the root element's font size, so the story sets that to 20 px.
 */
export function expectLargerBrowserTextSize(root: ParentNode): void {
	const html = document.documentElement
	const before = html.style.fontSize
	try {
		html.style.fontSize = '20px'
		expect(getComputedStyle(sample(root, 'body-large')).fontSize).toBe('20px')
	} finally {
		html.style.fontSize = before
	}
}

/** Two surfaces at one level cast the same shadow, and levels differ. */
export function expectNamedElevationLevels(root: ParentNode): void {
	const shadows = (selector: string) =>
		[...root.querySelectorAll<HTMLElement>(selector)].map(
			(element) => getComputedStyle(element).boxShadow,
		)
	const [menu, button] = shadows('[data-pair]')
	expect(menu).not.toBe('none')
	expect(button).toBe(menu)

	const byLevel = [1, 2, 3, 4, 5].map(
		(level) => shadows(`[data-level="${level}"]`)[0],
	)
	expect(new Set(byLevel).size).toBe(5)
	for (const shadow of byLevel) expect(shadow).not.toBe('none')
}
