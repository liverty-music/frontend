import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import {
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
		// The mouse half of design-tokens "Keyboard focus uses focus-visible" is
		// checked in e2e/functional/state-layers.spec.ts.
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
