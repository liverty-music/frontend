import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, spyOn, waitFor, within } from 'storybook/test'
import { page, userEvent } from 'vitest/browser'
import { consoleStoryParameters } from '../story-support'
import { CopyField } from './copy-field'

const meta = {
	title: 'Console/CopyField',
	component: CopyField,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		label: { control: 'text' },
		value: { control: 'text' },
	},
	args: {
		label: '受付1',
		value: 'https://reception.liverty-music.app/#c2Nhbm5lci10b2tlbg',
	},
} satisfies Meta<typeof CopyField>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `
			<div style="padding:16px; background:var(--md-color-surface); color:var(--md-color-on-surface)">
				<copy-field label.bind="label" value.bind="value"></copy-field>
				<console-snackbar></console-snackbar>
			</div>
		`,
		props: args,
	})

export const CopyIconOnAPhone = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Copy icon on a phone"
		await page.viewport(390, 844)
		const button = within(canvasElement).getByRole('button', {
			name: '受付1をコピー',
		})
		const icon = button.querySelector('svg')
		if (!icon) throw new Error('icon not rendered')
		await expect(icon.getBoundingClientRect().width).toBe(24)
		const target = button.getBoundingClientRect()
		await expect(target.width).toBeGreaterThanOrEqual(48)
		await expect(target.height).toBeGreaterThanOrEqual(48)
	},
} satisfies Story

export const CopyALink = {
	render,
	play: async ({ canvasElement, args }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Copy a link"
		const canvas = within(canvasElement)
		const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
		const icon = () =>
			canvasElement.querySelector('icon-button')?.getAttribute('data-copied')

		const button = canvas.getByRole('button', { name: '受付1をコピー' })
		const clickedAt = performance.now()
		await userEvent.click(button)

		await expect(write).toHaveBeenCalledWith(args.value)
		await waitFor(() => expect(icon()).toBe('true'))
		await expect(
			canvas.getByRole('button', { name: 'コピーしました' }),
		).toBeVisible()
		// Announced to screen readers through the snackbar.
		await waitFor(() =>
			expect(
				canvasElement.querySelector('snack-bar [role="status"]'),
			).toHaveTextContent('コピーしました'),
		)

		// Back to the copy icon after 2 seconds.
		await waitFor(() => expect(icon()).toBe('false'), { timeout: 3000 })
		await expect(performance.now() - clickedAt).toBeGreaterThanOrEqual(2000)
		write.mockRestore()
	},
} satisfies Story
