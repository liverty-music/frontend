import type { Meta, StoryObj } from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
import { expect as vitestExpect } from 'vitest'
import { InlineError } from './inline-error'

const meta = {
	title: 'Components/InlineError',
	component: InlineError,
	tags: ['test', 'autodocs'],
	argTypes: {
		message: {
			control: 'text',
			description:
				"The caller's message, already translated from the catalog. The error's own text is never shown.",
		},
	},
	args: {
		message: 'ライブの読み込みに失敗しました',
	},
} satisfies Meta<typeof InlineError>

export default meta
type Story = StoryObj<typeof meta>

// No retry callback → the Retry button is omitted.
export const Default = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByText('ライブの読み込みに失敗しました'),
		).toBeInTheDocument()
		await expect(
			canvas.queryByRole('button', { name: '再試行' }),
		).not.toBeInTheDocument()
		// Component-level visual regression against a committed baseline (D4/OQ2).
		await vitestExpect
			.element(canvasElement)
			.toMatchScreenshot('inline-error-default', {
				comparatorName: 'pixelmatch',
				comparatorOptions: { allowedMismatchedPixelRatio: 0.001 },
			})
	},
} satisfies Story

// With a retry callback the button renders, labelled from the catalog, and
// invokes the action on click.
export const WithRetry = {
	args: {
		retryAction: fn(),
	},
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement)
		const retry = canvas.getByRole('button', { name: '再試行' })
		await userEvent.click(retry)
		await expect(args.retryAction).toHaveBeenCalledOnce()
	},
} satisfies Story
