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
		// Hidden, not removed, so it can animate out; not rendered meanwhile.
		const description = canvasElement.querySelector<HTMLElement>(
			'.settings-toggle-desc',
		)
		await expect(description?.hidden).toBe(true)
		await expect(getComputedStyle(description as HTMLElement).display).toBe(
			'none',
		)
		// It opens and closes with a height and opacity transition.
		const transition = getComputedStyle(description as HTMLElement)
		await expect(transition.transitionProperty).toContain('block-size')
		await expect(transition.transitionProperty).toContain('opacity')
		await userEvent.click(sw)
		await expect(args.action).toHaveBeenCalledOnce()
		await atRest(userEvent, canvasElement)
		await expectScreenshot(canvasElement, 'settings-consent-row-collapsed')
	},
} satisfies Story

/** Expanded: opening the description does not change the switch. */
export const Expanded = {
	tags: ['japanese'],
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
