import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { atRest, inSettingsCard } from '../settings-list/settings-card-frame'
import { SettingsLinkRow } from './settings-link-row'

const meta = {
	title: 'Components/SettingsLinkRow',
	component: SettingsLinkRow,
	tags: ['test', 'autodocs'],
	argTypes: {
		icon: {
			control: 'text',
			description: '`svg-icon` name; empty for an iconless row.',
		},
		label: { control: 'text' },
		value: {
			control: 'text',
			description: 'Current value shown before the chevron.',
		},
		chevron: { control: 'boolean' },
	},
	args: { icon: 'globe', label: '言語', value: '日本語', chevron: true },
} satisfies Meta<typeof SettingsLinkRow>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: inSettingsCard(
			'<settings-link-row icon.bind="icon" label.bind="label" value.bind="value" chevron.bind="chevron" action.bind="action"></settings-link-row>',
		),
		props: args,
		register: [SettingsLinkRow],
	})

/** A selector row: icon, label, current value and chevron. Tapping it runs the action. */
export const WithValue = {
	args: { action: fn() },
	render,
	play: async ({ canvasElement, args }) => {
		const row = within(canvasElement).getByRole('button', { name: /言語/ })
		await expect(row).toHaveTextContent('日本語')
		await expect(row.querySelector('.settings-chevron')).not.toBeNull()
		await userEvent.click(row)
		await expect(args.action).toHaveBeenCalledOnce()
		await atRest(userEvent, canvasElement)
		await expectScreenshot(canvasElement, 'settings-link-row-with-value')
	},
} satisfies Story

/** A legal-page row: no icon, no value, chevron only. */
export const ChevronOnly = {
	args: { icon: '', label: '利用規約', value: '' },
	render,
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('.settings-icon')).toBeNull()
		await expect(canvasElement.querySelector('.settings-row-value')).toBeNull()
		await expectScreenshot(canvasElement, 'settings-link-row-chevron-only')
	},
} satisfies Story

/** The version row: a value and no chevron. */
export const ValueOnly = {
	args: { icon: '', label: 'バージョン', value: 'v1.128.1', chevron: false },
	render,
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('.settings-chevron')).toBeNull()
		await expectScreenshot(canvasElement, 'settings-link-row-value-only')
	},
} satisfies Story

/** A long label wraps inside its column without pushing the chevron out. */
export const LongLabel = {
	args: {
		icon: 'info',
		label: 'アナリティクスとセッションリプレイについてのプライバシーポリシー',
		value: '',
	},
	render,
	play: async ({ canvasElement }) => {
		const row = canvasElement.querySelector<HTMLElement>('.settings-row')
		const chevron =
			canvasElement.querySelector<HTMLElement>('.settings-chevron')
		if (!row || !chevron) throw new Error('no row')
		await expect(chevron.getBoundingClientRect().right).toBeLessThanOrEqual(
			row.getBoundingClientRect().right,
		)
		await expectScreenshot(canvasElement, 'settings-link-row-long-label')
	},
} satisfies Story
