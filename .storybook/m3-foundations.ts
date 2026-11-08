import { expect } from 'storybook/test'
import { page } from 'vitest/browser'
import sharedTokens from '../shared/styles/m3-sys.css?raw'

/**
 * Checks of the shared Material 3 foundations (shared/styles/m3-sys.css and
 * m3-typescale.css), run by a Foundations story in each app so that both the
 * fan app and the organizer console are verified with their own tokens.
 */

/** Markup of the type style samples, on the app's surface. */
export const TYPE_SAMPLES = `
	<div style="display:grid; gap:8px; padding:16px; background:var(--md-sys-color-surface); color:var(--md-sys-color-on-surface)">
		<p class="md-typescale-title-large" data-sample="title-large">Title large 公演の詳細</p>
		<p class="md-typescale-label-large" data-sample="label-large">Label large</p>
		<p class="md-typescale-label-large-emphasized" data-sample="label-large-emphasized">Label large emphasized</p>
		<p class="md-typescale-body-large" data-sample="body-large">Body large 本文</p>
	</div>
`

/** Markup of the elevation samples: two surfaces at level 2, and each level. */
export const ELEVATION_SAMPLES = `
	<div style="display:flex; flex-wrap:wrap; gap:24px; padding:24px; background:var(--md-sys-color-surface); color:var(--md-sys-color-on-surface)">
		<div data-level="2" style="padding:16px; background:var(--md-sys-color-surface-container); box-shadow:var(--md-sys-elevation-level2)">Menu</div>
		<div data-level="2" style="padding:16px; background:var(--md-sys-color-surface-container); box-shadow:var(--md-sys-elevation-level2)">Floating button</div>
		${[1, 3, 4, 5]
			.map(
				(level) =>
					`<div data-level="${level}" style="padding:16px; background:var(--md-sys-color-surface-container); box-shadow:var(--md-sys-elevation-level${level})">Level ${level}</div>`,
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
	// The window size stays with the browser tab for the stories that run after
	// this one, so it goes back to what it was.
	const { innerWidth, innerHeight } = window
	try {
		for (const width of [360, 1280]) {
			await page.viewport(width, 800)
			const style = getComputedStyle(sample(root, 'title-large'))
			expect(style.fontSize, `at ${width} px`).toBe('22px')
			expect(style.lineHeight, `at ${width} px`).toBe('28px')
		}
	} finally {
		await page.viewport(innerWidth, innerHeight)
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

/**
 * Material 3 elevation levels 1 to 5 (1, 3, 6, 8 and 12 dp): a key shadow at
 * 30 % and an ambient shadow at 15 % of the app's shadow colour, as
 * `[x, y, blur, spread]` in px.
 */
const LEVELS: Record<number, [number[], number[]]> = {
	1: [
		[0, 1, 2, 0],
		[0, 1, 3, 1],
	],
	2: [
		[0, 1, 2, 0],
		[0, 2, 6, 2],
	],
	3: [
		[0, 1, 3, 0],
		[0, 4, 8, 3],
	],
	4: [
		[0, 2, 3, 0],
		[0, 6, 10, 4],
	],
	5: [
		[0, 4, 4, 0],
		[0, 8, 12, 6],
	],
}

/** The computed shadow of the Material 3 definition of `level`, in `root`. */
function expectedShadow(root: ParentNode, level: number): string {
	const shade = (alpha: number) =>
		`color-mix(in oklch, var(--md-sys-color-shadow) ${alpha}%, transparent)`
	const [key, ambient] = LEVELS[level]
	const probe = document.createElement('div')
	probe.style.boxShadow = [
		`${key.map((px) => `${px}px`).join(' ')} ${shade(30)}`,
		`${ambient.map((px) => `${px}px`).join(' ')} ${shade(15)}`,
	].join(', ')
	;(root instanceof Document ? root.body : root).append(probe)
	const shadow = getComputedStyle(probe).boxShadow
	probe.remove()
	return shadow
}

/**
 * Each surface casts the shadow Material 3 defines for its level, so the menu
 * and the floating button at level 2 cast the same one.
 */
export function expectNamedElevationLevels(root: ParentNode): void {
	const surfaces = [...root.querySelectorAll<HTMLElement>('[data-level]')]
	expect(surfaces).toHaveLength(6)
	for (const surface of surfaces) {
		const level = Number(surface.dataset.level)
		expect(getComputedStyle(surface).boxShadow, `level ${level}`).toBe(
			expectedShadow(root, level),
		)
	}
}

/** Custom properties a stylesheet declares, with whitespace collapsed. */
function declared(css: string): Map<string, string> {
	return new Map(
		[...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
			m[1],
			m[2]
				.replace(/\s+/g, ' ')
				.replace(/\(\s/g, '(')
				.replace(/\s\)/g, ')')
				.trim(),
		]),
	)
}

/** The value `name` computes to on `element`, whitespace collapsed. */
function computed(element: Element, name: string): string {
	return getComputedStyle(element)
		.getPropertyValue(name)
		.replace(/\s+/g, ' ')
		.replace(/\(\s/g, '(')
		.replace(/\s\)/g, ')')
		.trim()
}

/**
 * Every state and motion token of the shared file computes, in this app, to
 * the value the shared file declares; with motion reduced, to its reduced
 * value. So an edit there reaches the app with no other edit.
 */
export function expectSharedStateAndMotion(element: Element): void {
	const reducedAt = sharedTokens.indexOf('@media (prefers-reduced-motion')
	const tokens = declared(sharedTokens.slice(0, reducedAt))
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
		for (const [name, value] of declared(sharedTokens.slice(reducedAt))) {
			tokens.set(name, value)
		}
	}
	const names = [...tokens.keys()].filter((name) =>
		/^--md-sys-(state|motion)-/.test(name),
	)
	expect(names.length).toBeGreaterThan(20)
	for (const name of names) {
		expect(computed(element, name), name).toBe(tokens.get(name))
	}
}

/** The app's surface colour is the one its own token file declares. */
export function expectOwnSurface(element: Element, appTokens: string): void {
	const own = declared(appTokens).get('--md-sys-color-surface')
	expect(own).toBeTruthy()
	expect(computed(element, '--md-sys-color-surface')).toBe(own)
}
