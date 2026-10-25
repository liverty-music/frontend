import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import {
	atRest,
	centreY,
	inSettingsCard,
} from '../settings-list/settings-card-frame'
import { SettingsStatusRow } from './settings-status-row'

const meta = {
	title: 'Components/SettingsStatusRow',
	component: SettingsStatusRow,
	tags: ['test', 'autodocs'],
	argTypes: {
		icon: { control: 'text' },
		label: { control: 'text' },
		verified: { control: 'boolean' },
		showAction: { control: 'boolean' },
		actionLabel: { control: 'text' },
		actionDisabled: { control: 'boolean' },
	},
	args: {
		icon: 'mail',
		label: 'fan@example.com',
		labelId: 'status-row-label',
		statusId: 'status-row-status',
		verified: false,
		verifiedText: '確認済み',
		unverifiedText: '未確認',
		showAction: true,
		actionLabel: '再送信',
		actionDisabled: false,
	},
} satisfies Meta<typeof SettingsStatusRow>

export default meta
type Story = StoryObj<typeof meta>

const row = (slot = '') =>
	`<settings-status-row icon.bind="icon" label.bind="label" label-id.bind="labelId" status-id.bind="statusId" verified.bind="verified" verified-text.bind="verifiedText" unverified-text.bind="unverifiedText" show-action.bind="showAction" action-label.bind="actionLabel" action-disabled.bind="actionDisabled" action.bind="action">${slot}</settings-status-row>`

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: inSettingsCard(row()),
		props: args,
		register: [SettingsStatusRow, BusyOnClickCustomAttribute],
	})

/** The icon is centred on the first line (the label), not on the whole block. */
async function expectIconOnLabelLine(
	canvasElement: HTMLElement,
): Promise<void> {
	const icon = canvasElement.querySelector('.settings-icon')
	const label = canvasElement.querySelector('.settings-row-label')
	if (!icon || !label) throw new Error('no icon or label')
	await expect(Math.abs(centreY(icon) - centreY(label))).toBeLessThanOrEqual(1)
}

/** Unverified: the badge and the action it allows on the line under the label. */
export const Unverified = {
	args: { action: fn() },
	render,
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement)
		const status = canvasElement.querySelector('#status-row-status')
		await expect(status).toHaveTextContent('未確認')
		await expect(
			canvasElement.querySelector('#status-row-label'),
		).toHaveAttribute('aria-describedby', 'status-row-status')
		await expect(status?.querySelector('svg-icon')).not.toBeNull()
		await expectIconOnLabelLine(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: '再送信' }))
		await expect(args.action).toHaveBeenCalledOnce()
		await atRest(userEvent, canvasElement)
		await expectScreenshot(canvasElement, 'settings-status-row-unverified')
	},
} satisfies Story

/** The action done: its button stays, disabled, saying so. */
export const ActionDone = {
	args: { actionLabel: '送信済み！', actionDisabled: true },
	render,
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole('button', { name: '送信済み！' }),
		).toBeDisabled()
		await expectScreenshot(canvasElement, 'settings-status-row-action-done')
	},
} satisfies Story

/** Verified: the success badge and no action. */
export const Verified = {
	args: { verified: true, showAction: false },
	render,
	play: async ({ canvasElement }) => {
		await expect(
			canvasElement.querySelector('#status-row-status'),
		).toHaveTextContent('確認済み')
		await expect(within(canvasElement).queryByRole('button')).toBeNull()
		await expectIconOnLabelLine(canvasElement)
		await expectScreenshot(canvasElement, 'settings-status-row-verified')
	},
} satisfies Story

/** A long address takes the row's full width and breaks only between words. */
export const LongAddress = {
	args: { label: 'pannpers+email-verification-test2@liverty-music.example' },
	render,
	play: async ({ canvasElement }) => {
		const label = canvasElement.querySelector<HTMLElement>(
			'.settings-row-label',
		)
		const card = canvasElement.querySelector<HTMLElement>('.settings-card')
		if (!label || !card) throw new Error('no label')
		await expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(
			card.getBoundingClientRect().right,
		)
		await expect(getComputedStyle(label).overflowWrap).toBe('break-word')
		await expectIconOnLabelLine(canvasElement)
		await expectScreenshot(canvasElement, 'settings-status-row-long-address')
	},
} satisfies Story

/** Verified with a detail line projected below the status (本人確認). */
export const VerifiedWithDetail = {
	args: {
		icon: 'shield-check',
		label: '本人確認',
		verified: true,
		showAction: false,
	},
	render: (args) =>
		defineAureliaStory({
			template: inSettingsCard(
				row('<span class="detail">マイナンバーカードで確認</span>'),
			),
			props: args,
			register: [SettingsStatusRow, BusyOnClickCustomAttribute],
		}),
	play: async ({ canvasElement }) => {
		const status = canvasElement.querySelector('#status-row-status')
		const detail = canvasElement.querySelector('.detail')
		if (!status || !detail) throw new Error('no detail')
		await expect(detail.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			status.getBoundingClientRect().bottom,
		)
		await expectScreenshot(
			canvasElement,
			'settings-status-row-verified-with-detail',
		)
	},
} satisfies Story
