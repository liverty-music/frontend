import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import { hoverPointer } from '../../../.storybook/gestures'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { canvasOf, consoleStoryParameters, roleColor } from '../story-support'
import { IconButton } from './icon-button'

// The console's icon button: the shared `icon-button` block
// (`shared/styles/icon-button.css`) inside the component's shadow root, with
// the console's tokens. Each state checks the Material 3 small standard icon
// button: a 40px round container, a 48px target, an `on-surface-variant`
// icon, and the 8 % hover and 10 % focus state layers. (A line comment: a
// JSDoc block on the meta makes Storybook's docs plugin rewrite `parameters`,
// which drops `consoleStoryParameters` and with it the console's components
// and shadow-root styles.)
const meta = {
	title: 'Console/IconButton',
	component: IconButton,
	parameters: consoleStoryParameters,
	argTypes: {
		icon: { control: 'text' },
		label: { control: 'text' },
		disabled: { control: 'boolean' },
		pressed: { control: 'boolean' },
	},
	args: { icon: 'more-vert', label: 'メニュー', disabled: false },
} satisfies Meta<typeof IconButton>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="padding:16px; background:var(--md-sys-color-surface)"><icon-button icon.bind="icon" label.bind="label" disabled.bind="disabled" pressed.bind="pressed"></icon-button></div>`,
		props: args,
	})

const buttonOf = (canvasElement: HTMLElement) =>
	canvasOf(canvasElement)
		.getByRole('button', { name: 'メニュー' })
		.element() as HTMLButtonElement

const layer = (el: HTMLElement) =>
	Number.parseFloat(getComputedStyle(el, '::before').opacity)

async function expectShape(button: HTMLElement): Promise<void> {
	const box = button.getBoundingClientRect()
	await expect(box.width).toBe(40)
	await expect(box.height).toBe(40)
	const target = getComputedStyle(button, '::after')
	await expect(target.width).toBe('48px')
	await expect(target.height).toBe('48px')
	await expect(
		Number.parseFloat(getComputedStyle(button).borderTopLeftRadius),
	).toBeGreaterThan(20)
}

export const Default = {
	render,
	play: async ({ canvasElement }) => {
		const button = buttonOf(canvasElement)
		await expectShape(button)
		await expect(getComputedStyle(button).color).toBe(
			roleColor(canvasElement, '--md-sys-color-on-surface-variant'),
		)
		await expect(layer(button)).toBe(0)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'console-icon-button-rest',
		)
	},
} satisfies Story

/** A real pointer over the button raises the 8 % state layer. */
export const Hovered = {
	render,
	play: async ({ canvasElement }) => {
		const button = buttonOf(canvasElement)
		await expectShape(button)
		if (!(await hoverPointer(button))) return
		await waitFor(() => expect(layer(button)).toBeCloseTo(0.08, 2))
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'console-icon-button-hovered',
		)
	},
} satisfies Story

/** Keyboard focus: the console's ring and the 10 % state layer. */
export const Focused = {
	render,
	play: async ({ canvasElement }) => {
		const button = buttonOf(canvasElement)
		await userEvent.keyboard('{Tab}')
		await waitFor(() => expect(button.matches(':focus-visible')).toBe(true))
		await expect(getComputedStyle(button).outlineStyle).toBe('solid')
		await waitFor(() => expect(layer(button)).toBeCloseTo(0.1, 2))
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'console-icon-button-focused',
		)
	},
} satisfies Story

export const Disabled = {
	args: { disabled: true },
	render,
	play: async ({ canvasElement }) => {
		const button = buttonOf(canvasElement)
		await expectShape(button)
		await expect(button).toBeDisabled()
		await expect(getComputedStyle(button).cursor).toBe('not-allowed')
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'console-icon-button-disabled',
		)
	},
} satisfies Story
