import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import { atRest, inSettingsCard } from '../settings-list/settings-card-frame'
import { SettingsSwitchRow } from './settings-switch-row'

const meta = {
	title: 'Components/SettingsSwitchRow',
	component: SettingsSwitchRow,
	tags: ['test', 'autodocs'],
	argTypes: {
		icon: { control: 'text' },
		label: { control: 'text' },
		description: {
			control: 'text',
			description: 'Shown under the label and referenced by the switch.',
		},
		checked: { control: 'boolean' },
		unavailable: {
			control: 'boolean',
			description: 'Kept focusable (aria-disabled), dimmed.',
		},
	},
	args: {
		icon: 'music',
		label: '効果音',
		description: '',
		descriptionId: 'switch-row-desc',
		checked: true,
		unavailable: false,
	},
} satisfies Meta<typeof SettingsSwitchRow>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: inSettingsCard(
			'<settings-switch-row icon.bind="icon" label.bind="label" description.bind="description" description-id.bind="descriptionId" checked.bind="checked" unavailable.bind="unavailable" action.bind="action"></settings-switch-row>',
		),
		props: args,
		register: [SettingsSwitchRow, BusyOnClickCustomAttribute],
	})

/** On: the whole row is the switch, and tapping it runs the action. */
export const On = {
	args: { action: fn() },
	render,
	play: async ({ canvasElement, args }) => {
		const sw = within(canvasElement).getByRole('switch', { name: /効果音/ })
		await expect(sw).toHaveAttribute('aria-checked', 'true')
		await userEvent.click(sw)
		await expect(args.action).toHaveBeenCalledOnce()
		await atRest(userEvent, canvasElement)
		await expectScreenshot(canvasElement, 'settings-switch-row-on')
	},
} satisfies Story

export const Off = {
	args: { checked: false },
	render,
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole('switch')).toHaveAttribute(
			'aria-checked',
			'false',
		)
		await expectScreenshot(canvasElement, 'settings-switch-row-off')
	},
} satisfies Story

/** With a description, which the switch references. */
export const WithDescription = {
	args: {
		icon: 'swap',
		label: '左利きモード',
		description: 'メニューボタンが左手で操作しやすい位置に開きます。',
	},
	render,
	play: async ({ canvasElement }) => {
		const sw = within(canvasElement).getByRole('switch', {
			name: /左利きモード/,
		})
		await expect(sw).toHaveAttribute('aria-describedby', 'switch-row-desc')
		await expect(
			canvasElement.querySelector('#switch-row-desc'),
		).toHaveTextContent('メニューボタン')
		await expectScreenshot(
			canvasElement,
			'settings-switch-row-with-description',
		)
	},
} satisfies Story

/** Unavailable: still in the accessibility tree, dimmed, with the reason. */
export const Unavailable = {
	args: {
		icon: 'bell',
		label: 'プッシュ通知',
		description: 'この環境では利用できません',
		checked: false,
		unavailable: true,
	},
	render,
	play: async ({ canvasElement }) => {
		const sw = within(canvasElement).getByRole('switch', {
			name: /プッシュ通知/,
		})
		await expect(sw).toHaveAttribute('aria-disabled', 'true')
		await expect(sw).not.toBeDisabled()
		await expect(sw).toHaveAttribute('aria-describedby', 'switch-row-desc')
		await expectScreenshot(canvasElement, 'settings-switch-row-unavailable')
	},
} satisfies Story
