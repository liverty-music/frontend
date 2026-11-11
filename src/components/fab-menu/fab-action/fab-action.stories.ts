import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { FabAction } from './fab-action'

const meta = {
	title: 'Components/FabAction',
	component: FabAction,
} satisfies Meta<typeof FabAction>

export default meta
type Story = StoryObj<typeof meta>

const ACTION = {
	id: 'beam',
	labelKey: 'fabMenu.beam',
	icon: 'info',
	kind: 'toggle',
	invoke: () => undefined,
}

/** One arc item, with room on the left for its label. */
const render =
	(active: boolean, pressed: boolean | null): Story['render'] =>
	() =>
		defineAureliaStory({
			template: `
				<div style="padding-inline-start: 8rem">
					<fab-action action.bind="action" active.bind="active" pressed.bind="pressed"></fab-action>
				</div>
			`,
			props: { action: ACTION, active, pressed },
			register: [FabAction],
		})

const item = (root: HTMLElement) =>
	root.querySelector('.fab-item') as HTMLButtonElement

/** Off: the menu surface, a 48 px circle, its label beside it. */
export const Default = {
	render: render(false, false),
	play: async ({ canvasElement }) => {
		const button = item(canvasElement)
		await expect(button.getBoundingClientRect().width).toBe(48)
		await expect(button.getAttribute('aria-pressed')).toBe('false')
		const label = button.querySelector('.fab-item-label') as Element
		await expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(
			button.getBoundingClientRect().left,
		)
	},
} satisfies Story

/** On: the filled primary container (a pressed toggle). */
export const Pressed = {
	render: render(true, true),
	play: async ({ canvasElement }) => {
		const button = item(canvasElement)
		await expect(button.getAttribute('aria-pressed')).toBe('true')
		await expect(button.dataset.active).toBe('true')
	},
} satisfies Story

/** A command has no pressed state: no `aria-pressed` at all. */
export const Command = {
	render: render(false, null),
	play: async ({ canvasElement }) => {
		await expect(item(canvasElement).hasAttribute('aria-pressed')).toBe(false)
	},
} satisfies Story
