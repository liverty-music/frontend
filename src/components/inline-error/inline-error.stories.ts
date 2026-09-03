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
			description: 'Human-readable heading shown above the error detail.',
		},
	},
	args: {
		message: 'Failed to load data',
		error: 'Network request timed out',
	},
} satisfies Meta<typeof InlineError>

export default meta
type Story = StoryObj<typeof meta>

// No retry callback → the Retry button is omitted.
export const Default = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByText('Failed to load data')).toBeInTheDocument()
		await expect(
			canvas.queryByRole('button', { name: 'Retry' }),
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

// An Error instance surfaces its `message` as the detail line.
export const FromErrorObject = {
	args: {
		message: 'Could not load your artists',
		error: new Error('HTTP 503 Service Unavailable'),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByText('HTTP 503 Service Unavailable'),
		).toBeInTheDocument()
	},
} satisfies Story

// With a retry callback the button renders and invokes the action on click.
export const WithRetry = {
	args: {
		message: 'Could not load concerts',
		error: 'Temporary failure',
		retryAction: fn(),
	},
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement)
		const retry = canvas.getByRole('button', { name: 'Retry' })
		await userEvent.click(retry)
		await expect(args.retryAction).toHaveBeenCalledOnce()
	},
} satisfies Story
