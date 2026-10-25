import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import { atRest, inSettingsCard } from '../settings-list/settings-card-frame'
import { SettingsConsentRow } from './settings-consent-row'

const meta = {
	title: 'Components/SettingsConsentRow',
	component: SettingsConsentRow,
	tags: ['test', 'autodocs'],
	argTypes: {
		icon: { control: 'text' },
		label: { control: 'text' },
		description: {
			control: 'text',
			description: 'Opened by tapping the label.',
		},
		checked: { control: 'boolean' },
	},
	args: {
		icon: 'info',
		label: 'アナリティクス',
		description:
			'アプリの改善のため、操作の記録を送信します。いつでもオフにできます。',
		checked: true,
	},
} satisfies Meta<typeof SettingsConsentRow>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: inSettingsCard(
			'<settings-consent-row icon.bind="icon" label.bind="label" description.bind="description" checked.bind="checked" action.bind="action"></settings-consent-row>',
		),
		props: args,
		register: [SettingsConsentRow, BusyOnClickCustomAttribute],
	})

/** Collapsed: the label is a disclosure, the switch a separate named control. */
export const Collapsed = {
	args: { action: fn() },
	render,
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement)
		const disclosure = canvas.getByRole('button', {
			name: /アナリティクス/,
			expanded: false,
		})
		const sw = canvas.getByRole('switch', { name: 'アナリティクス' })
		await expect(disclosure.contains(sw)).toBe(false)
		await expect(
			canvasElement.querySelector('.settings-toggle-desc'),
		).toBeNull()
		await userEvent.click(sw)
		await expect(args.action).toHaveBeenCalledOnce()
		await atRest(userEvent, canvasElement)
		await expectScreenshot(canvasElement, 'settings-consent-row-collapsed')
	},
} satisfies Story

/** Expanded: opening the description does not change the switch. */
export const Expanded = {
	args: { action: fn() },
	render,
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement)
		await userEvent.click(
			canvas.getByRole('button', { name: /アナリティクス/, expanded: false }),
		)
		await expect(
			canvas.getByRole('button', { expanded: true }),
		).toHaveTextContent('操作の記録')
		await expect(args.action).not.toHaveBeenCalled()
		await expect(canvas.getByRole('switch')).toHaveAttribute(
			'aria-checked',
			'true',
		)
		await atRest(userEvent, canvasElement)
		await expectScreenshot(canvasElement, 'settings-consent-row-expanded')
	},
} satisfies Story

export const Off = {
	args: { icon: 'lock', label: 'セッションリプレイ', checked: false },
	render,
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole('switch', { name: 'セッションリプレイ' }),
		).toHaveAttribute('aria-checked', 'false')
		await expectScreenshot(canvasElement, 'settings-consent-row-off')
	},
} satisfies Story
