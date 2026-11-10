import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, spyOn, waitFor } from 'storybook/test'
import { page, userEvent } from 'vitest/browser'
import { canvasOf, consoleStoryParameters, deepQuery } from '../story-support'
import { CopyField } from './copy-field'

const meta = {
	title: 'Console/CopyField',
	component: CopyField,
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
			<div style="padding:16px; background:var(--md-sys-color-surface); color:var(--md-sys-color-on-surface)">
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
		const button = canvasOf(canvasElement)
			.getByRole('button', { name: '受付1をコピー' })
			.element()
		const icon = deepQuery(button, 'svg')
		await expect(icon.getBoundingClientRect().width).toBe(24)
		// The shared icon button is 40 px; its target reaches 4 px past each
		// edge, so a tap 3 px outside the visible circle still lands on it.
		const box = button.getBoundingClientRect()
		await expect(box.width).toBe(40)
		const root = button.getRootNode() as ShadowRoot
		const cx = box.left + box.width / 2
		const cy = box.top + box.height / 2
		for (const [x, y] of [
			[box.left - 3, cy],
			[box.right + 3, cy],
			[cx, box.top - 3],
			[cx, box.bottom + 3],
		]) {
			await expect(root.elementFromPoint(x, y)).toBe(button)
		}
	},
} satisfies Story

export const CopyALink = {
	render,
	play: async ({ canvasElement, args }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Copy a link"
		const canvas = canvasOf(canvasElement)
		const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
		const icon = () =>
			deepQuery(canvasElement, 'icon-button').getAttribute('data-copied')

		const button = canvas
			.getByRole('button', { name: '受付1をコピー' })
			.element()
		const clickedAt = performance.now()
		await userEvent.click(button)

		await expect(write).toHaveBeenCalledWith(args.value)
		await waitFor(() => expect(icon()).toBe('true'))
		await expect(
			canvas.getByRole('button', { name: 'コピーしました' }).element(),
		).toBeVisible()
		// Announced to screen readers through the snackbar.
		await waitFor(() =>
			expect(
				deepQuery(canvasElement, 'snack-bar [role="status"]'),
			).toHaveTextContent('コピーしました'),
		)

		// Back to the copy icon after 2 seconds.
		await waitFor(() => expect(icon()).toBe('false'), { timeout: 3000 })
		await expect(performance.now() - clickedAt).toBeGreaterThanOrEqual(2000)
		write.mockRestore()
	},
} satisfies Story
