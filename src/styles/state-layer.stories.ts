import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor } from 'storybook/test'
import { composite, contrast, resolveColor } from '../../.storybook/contrast'
import { hoverPointer } from '../../.storybook/gestures'
import {
	alphaOf,
	expectHover,
	expectKeyboardFocus,
	expectPress,
	expectRest,
	layerOpacity,
	STATE_LAYER_SAMPLES,
} from '../../.storybook/state-layer'

/**
 * The shared state layer (`shared/styles/state-layer.css`) in the fan app:
 * hover, keyboard focus and press with a real pointer and keyboard, and the
 * busy spinner, which takes the other pseudo-element.
 */
const meta = {
	title: 'Foundations/State Layer',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Rest = {
	render: () => defineAureliaStory({ template: STATE_LAYER_SAMPLES }),
	play: async ({ canvasElement }) => {
		expectRest(canvasElement)
	},
} satisfies Story

export const Hovered = {
	render: () => defineAureliaStory({ template: STATE_LAYER_SAMPLES }),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/design-tokens "Hover applies the shared 8% overlay"
		await expectHover(canvasElement)
	},
} satisfies Story

export const KeyboardFocused = {
	render: () => defineAureliaStory({ template: STATE_LAYER_SAMPLES }),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/design-tokens "Keyboard focus uses focus-visible"
		// @spec components/infrastructure/fan/web/global/design-tokens "Pointer click"
		await expectKeyboardFocus(canvasElement)
	},
} satisfies Story

export const Pressed = {
	render: () => defineAureliaStory({ template: STATE_LAYER_SAMPLES }),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/design-tokens "Press applies the shared 10% overlay"
		await expectPress(canvasElement, '[data-sample="press"]')
	},
} satisfies Story

/**
 * A busy filled button (`busy-on-click` sets `data-busy`): the spinner on
 * ::after shows over the button while the state layer keeps ::before, so the
 * two no longer compete for one pseudo-element. The label is hidden (its text
 * fill is transparent) so it does not show through the spinner.
 */
export const BusyButton = {
	tags: ['reduced-motion'],
	parameters: {
		// The busy label is not shown (its text fill is transparent), but axe
		// measures the text colour, dimmed to 65 % with the control, and finds
		// it below 4.5:1. No sighted user reads that text while busy.
		a11y: { options: { rules: { 'color-contrast': { enabled: false } } } },
	},
	render: () =>
		defineAureliaStory({
			template: `<div style="padding:16px"><button type="button" class="[ button ] [ state-layer ]" data-busy aria-busy="true">Save</button></div>`,
		}),
	play: async ({ canvasElement }) => {
		const button = canvasElement.querySelector('button') as HTMLButtonElement
		const spinner = getComputedStyle(button, '::after')
		await expect(spinner.content).toBe('""')
		await expect(spinner.position).toBe('absolute')
		await expect(spinner.width).toBe('16px')
		await expect(spinner.height).toBe('16px')
		await expect(Number.parseFloat(spinner.borderTopWidth)).toBeGreaterThan(0)
		// Centred on the button.
		await expect(spinner.translate).toBe('-50% -50%')
		await expect(spinner.animationName).toBe(
			matchMedia('(prefers-reduced-motion: reduce)').matches
				? 'none'
				: 'busy-spin',
		)
		// The state layer is still the other pseudo-element.
		await expect(getComputedStyle(button, '::before').content).toBe('""')
		await expect(layerOpacity(button)).toBe(0)
		await expect(getComputedStyle(button).opacity).toBe('0.65')
		// The label does not show through the spinner.
		await expect(
			getComputedStyle(button).getPropertyValue('-webkit-text-fill-color'),
		).toBe('rgba(0, 0, 0, 0)')
	},
} satisfies Story

/**
 * A selected control keeps its 12 % selected layer at rest and under the
 * pointer, with the 8 % hover layer drawn over it.
 */
export const SelectedStacksWithHover = {
	render: () =>
		defineAureliaStory({
			template: `<div style="padding:16px; color:oklch(98% 0 0deg); background:oklch(20% 0.04 275deg)"><button type="button" class="state-layer" data-selected-morph aria-pressed="true" data-sample="selected">Selected</button></div>`,
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/design-tokens "Selected state persists and stacks"
		const el = canvasElement.querySelector<HTMLElement>('button')
		if (!el) throw new Error('no button')
		await expect(alphaOf(getComputedStyle(el).backgroundColor)).toBeCloseTo(
			0.12,
			5,
		)
		await expect(layerOpacity(el)).toBe(0)
		if (!(await hoverPointer(el))) return
		// The selected layer stays and the hover layer is drawn over it.
		await waitFor(() => expect(layerOpacity(el)).toBeCloseTo(0.08, 5))
		await expect(alphaOf(getComputedStyle(el).backgroundColor)).toBeCloseTo(
			0.12,
			5,
		)
	},
} satisfies Story

/** A leaving element accelerates: the accelerate easing token's curve. */
export const LeavingAccelerates = {
	render: () =>
		defineAureliaStory({
			template: `<span style="transition: opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized-accelerate)">Leaving</span>`,
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/design-tokens "Leaving element accelerates"
		const el = canvasElement.querySelector('span')
		if (!el) throw new Error('no element')
		await expect(getComputedStyle(el).transitionTimingFunction).toBe(
			'cubic-bezier(0.3, 0, 0.8, 0.15)',
		)
	},
} satisfies Story

/** The focus ring colour reaches 3:1 against every surface tier of the app. */
export const FocusRingContrast = {
	render: () => defineAureliaStory({ template: '<div></div>' }),
	play: async ({ canvasElement }) => {
		const host = canvasElement
		const ring = composite(
			resolveColor(host, 'var(--md-sys-color-focus-indicator)'),
		)
		const tiers = [
			'surface',
			'surface-container-lowest',
			'surface-container-low',
			'surface-container',
			'surface-container-high',
			'surface-container-highest',
		]
		for (const tier of tiers) {
			const surface = composite(
				resolveColor(host, `var(--md-sys-color-${tier})`),
			)
			await expect(contrast(ring, surface), tier).toBeGreaterThanOrEqual(3)
		}
	},
} satisfies Story
