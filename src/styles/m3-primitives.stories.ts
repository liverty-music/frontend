import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'

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
	tags: ['test', 'autodocs'],
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

// ── Selection spring-morph primitive ([data-selected-morph]) ─────────────────
// Rendered on a surface with real ink so the persistent selected state layer
// and rounder shape are visible (and axe sees a real fg/bg pair).
export const SelectionMorph = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:flex; gap:1rem; padding:1rem; background:var(--md-color-surface); color:var(--md-color-on-surface)">
					<span data-selected-morph style="padding:0.5rem 1rem; border-radius:var(--md-shape-large)">Unselected</span>
					<span data-selected-morph data-selected style="padding:0.5rem 1rem">Selected</span>
				</div>
			`,
		}),
} satisfies Story

// ── Color roles: fill + on-* pairs, contrast-enforced ────────────────────────
const ROLE_PAIRS: ReadonlyArray<{ label: string; fill: string; on: string }> = [
	{ label: 'primary', fill: '--md-color-primary', on: '--md-color-on-primary' },
	{
		label: 'secondary',
		fill: '--md-color-secondary',
		on: '--md-color-on-secondary',
	},
	{
		label: 'tertiary',
		fill: '--md-color-tertiary',
		on: '--md-color-on-tertiary',
	},
	{ label: 'error', fill: '--md-color-error', on: '--md-color-on-error' },
	{
		label: 'primary-container',
		fill: '--md-color-primary-container',
		on: '--md-color-on-primary-container',
	},
	{
		label: 'secondary-container',
		fill: '--md-color-secondary-container',
		on: '--md-color-on-secondary-container',
	},
	{
		label: 'tertiary-container',
		fill: '--md-color-tertiary-container',
		on: '--md-color-on-tertiary-container',
	},
	{
		label: 'error-container',
		fill: '--md-color-error-container',
		on: '--md-color-on-error-container',
	},
	{
		label: 'surface / on-surface',
		fill: '--md-color-surface',
		on: '--md-color-on-surface',
	},
	{
		label: 'surface / on-surface-variant',
		fill: '--md-color-surface',
		on: '--md-color-on-surface-variant',
	},
]

export const ColorRoles = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:flex; flex-direction:column; gap:0.5rem; inline-size:22rem; padding:1rem">
					${ROLE_PAIRS.map(
						(p) =>
							`<div data-role-pair="${p.label}" style="padding:0.75rem 1rem; border-radius:var(--md-shape-small); background:var(${p.fill}); color:var(${p.on})">${p.label}</div>`,
					).join('')}
				</div>
			`,
		}),
} satisfies Story
