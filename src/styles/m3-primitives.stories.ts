import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import {
	composite,
	contrast,
	resolveColor,
	WCAG_AA,
} from '../../.storybook/contrast'

/**
 * Foundations story for the GLOBAL M3 primitives + color roles that live in the
 * `@layer` chain (tokens/global/utility), not in any single component. These
 * are only renderable because `.storybook/preview.ts` loads the global style
 * layer. Purpose:
 *
 *  - Exercise the global primitives (`.skeleton`, `[data-selected-morph]`) so
 *    they render (and regress via a11y) in the same env as the app.
 *  - Enforce the M3 color contract: every role fill is rendered with its `on-*`
 *    pair as real text, so the shared axe `color-contrast` rule (a11y.test:
 *    'error') fails the story if any pair drops below the WCAG target. Using axe
 *    rather than a hand-rolled parser keeps this correct across CSS color spaces
 *    (Chromium serializes computed colors as `oklch()`/`color(srgb …)`).
 */
const meta = {
	title: 'Foundations/M3 Primitives',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// ── Skeleton loading primitive (global `.skeleton` utility) ──────────────────
export const Skeleton = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:flex; flex-direction:column; gap:1rem; inline-size:20rem; padding:1rem">
					<div class="skeleton" style="block-size:1.5rem"></div>
					<div class="skeleton" style="block-size:1.5rem; inline-size:70%"></div>
					<div class="skeleton" style="block-size:1.5rem; inline-size:45%"></div>
				</div>
			`,
		}),
} satisfies Story

/**
 * A list that has loaded takes the skeleton's place: its rows are the height of
 * the placeholder rows, and they fade in one after another (`content-arrive-rows`),
 * with nothing moving. Under reduced motion the skeleton does not animate and the
 * rows arrive together in 100 ms at most. Runs in both Storybook projects and
 * asserts the presentation of the one in use.
 */
export const SkeletonToContent = {
	tags: ['reduced-motion'],
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:flex; flex-direction:column; gap:1rem; inline-size:20rem; padding:1rem">
					<div class="skeleton-list" style="display:grid; gap:0.5rem">
						<div class="skeleton" style="block-size:3rem"></div>
						<div class="skeleton" style="block-size:3rem"></div>
						<div class="skeleton" style="block-size:3rem"></div>
					</div>
					<ul class="content-list content-arrive-rows" style="display:grid; gap:0.5rem; margin:0; padding:0; list-style:none">
						<li style="block-size:3rem">Row 1</li>
						<li style="block-size:3rem">Row 2</li>
						<li style="block-size:3rem">Row 3</li>
					</ul>
				</div>
			`,
		}),
	play: async ({ canvasElement }) => {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		const placeholders = [
			...canvasElement.querySelectorAll<HTMLElement>('.skeleton'),
		]
		const rows = [
			...canvasElement.querySelectorAll<HTMLElement>('.content-list > li'),
		]

		// @spec components/infrastructure/fan/web/global/ui-primitives "List loads"
		// The rows take the placeholder rows' space, so nothing moves when they arrive.
		await expect(rows.map((r) => r.getBoundingClientRect().height)).toEqual(
			placeholders.map((p) => p.getBoundingClientRect().height),
		)
		for (const row of rows) {
			await expect(getComputedStyle(row).animationName).toBe('content-arrive')
		}
		// Only the opacity changes: no transform on the way in.
		for (const row of rows) {
			const frames = row
				.getAnimations()
				.flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
			await expect(frames.every((f) => !('transform' in f))).toBe(true)
		}
		const delays = rows.map((r) => getComputedStyle(r).animationDelay)
		const durations = rows.map((r) => getComputedStyle(r).animationDuration)

		// @spec components/infrastructure/fan/web/global/ui-primitives "Reduced motion"
		if (reduce) {
			for (const p of placeholders) {
				await expect(getComputedStyle(p).animationName).toBe('none')
			}
			await expect(new Set(delays)).toEqual(new Set(['0s']))
			await expect(durations.every((d) => Number.parseFloat(d) <= 0.1)).toBe(
				true,
			)
		} else {
			for (const p of placeholders) {
				await expect(getComputedStyle(p).animationName).toBe('skeleton-shimmer')
			}
			// One step after another: 0, 50, 100 ms.
			await expect(delays).toEqual(['0s', '0.05s', '0.1s'])
		}
	},
} satisfies Story

// ── Selection spring-morph primitive ([data-selected-morph]) ─────────────────
// Rendered on a surface with real ink so the persistent selected state layer
// and rounder shape are visible (and axe sees a real fg/bg pair).
export const SelectionMorph = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:flex; gap:1rem; padding:1rem; background:var(--md-sys-color-surface); color:var(--md-sys-color-on-surface)">
					<span data-selected-morph style="padding:0.5rem 1rem; border-radius:var(--md-sys-shape-corner-large)">Unselected</span>
					<span data-selected-morph data-selected style="padding:0.5rem 1rem">Selected</span>
				</div>
			`,
		}),
} satisfies Story

// ── Color roles: fill + on-* pairs, contrast-enforced ────────────────────────
const ROLE_PAIRS: ReadonlyArray<{ label: string; fill: string; on: string }> = [
	{
		label: 'primary',
		fill: '--md-sys-color-primary',
		on: '--md-sys-color-on-primary',
	},
	{
		label: 'secondary',
		fill: '--md-sys-color-secondary',
		on: '--md-sys-color-on-secondary',
	},
	{
		label: 'tertiary',
		fill: '--md-sys-color-tertiary',
		on: '--md-sys-color-on-tertiary',
	},
	{
		label: 'error',
		fill: '--md-sys-color-error',
		on: '--md-sys-color-on-error',
	},
	{
		label: 'primary-container',
		fill: '--md-sys-color-primary-container',
		on: '--md-sys-color-on-primary-container',
	},
	{
		label: 'secondary-container',
		fill: '--md-sys-color-secondary-container',
		on: '--md-sys-color-on-secondary-container',
	},
	{
		label: 'tertiary-container',
		fill: '--md-sys-color-tertiary-container',
		on: '--md-sys-color-on-tertiary-container',
	},
	{
		label: 'error-container',
		fill: '--md-sys-color-error-container',
		on: '--md-sys-color-on-error-container',
	},
	{
		label: 'surface / on-surface',
		fill: '--md-sys-color-surface',
		on: '--md-sys-color-on-surface',
	},
	{
		label: 'surface / on-surface-variant',
		fill: '--md-sys-color-surface',
		on: '--md-sys-color-on-surface-variant',
	},
]

/** The [l, c, h] of a computed `oklch(l c h)` colour. */
function oklch(color: string): number[] {
	const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(color)
	if (!match) throw new Error(`not an oklch colour: ${color}`)
	return match.slice(1).map(Number)
}

export const ColorRoles = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:flex; flex-direction:column; gap:0.5rem; inline-size:22rem; padding:1rem">
					${ROLE_PAIRS.map(
						(p) =>
							`<div data-role-pair="${p.label}" style="padding:0.75rem 1rem; border-radius:var(--md-sys-shape-corner-small); background:var(${p.fill}); color:var(${p.on})">${p.label}</div>`,
					).join('')}
				</div>
			`,
		}),
	play: async ({ canvasElement }) => {
		const pair = canvasElement.querySelector<HTMLElement>(
			'[data-role-pair="primary"]',
		)
		if (!pair) throw new Error('no primary pair')
		const style = getComputedStyle(pair)
		const brand = resolveColor(pair, 'var(--color-brand-primary)')

		// @spec components/infrastructure/fan/web/global/design-tokens "Primary role takes a white label at every size"
		await expect(style.color).toBe(resolveColor(pair, 'var(--color-white)'))
		await expect(
			contrast(composite(style.backgroundColor), composite(style.color)),
		).toBeGreaterThanOrEqual(WCAG_AA)
		// The fill keeps brand-primary's hue and chroma; only the tone differs.
		const [, brandC, brandH] = oklch(brand)
		const [fillL, fillC, fillH] = oklch(
			resolveColor(pair, 'var(--md-sys-color-primary)'),
		)
		await expect(fillC).toBeCloseTo(brandC, 3)
		await expect(fillH).toBeCloseTo(brandH, 1)
		await expect(fillL).toBeCloseTo(0.57, 3)

		// @spec components/infrastructure/fan/web/global/design-tokens "The brand colour stays for surfaces without text"
		// The brand token itself stays bright for the FAB, lines and glows.
		await expect(oklch(brand)).toEqual([0.65, 0.28, 350])
	},
} satisfies Story
