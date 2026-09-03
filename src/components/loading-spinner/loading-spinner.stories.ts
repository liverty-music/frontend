import type { Meta, StoryObj } from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { LoadingSpinner } from './loading-spinner'

const meta = {
	title: 'Components/LoadingSpinner',
	component: LoadingSpinner,
	tags: ['test', 'autodocs'],
	argTypes: {
		size: {
			control: 'select',
			options: ['sm', 'md', 'lg'],
			description: 'Diameter preset of the spinner.',
		},
	},
} satisfies Meta<typeof LoadingSpinner>

export default meta
type Story = StoryObj<typeof meta>

export const Medium = {
	args: { size: 'md' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// The spinner exposes a live status region for assistive tech.
		const status = canvas.getByRole('status')
		await expect(status).toBeInTheDocument()
		await expect(status).toHaveAttribute('aria-busy', 'true')
		await expect(status).toHaveAttribute('data-size', 'md')
	},
} satisfies Story

export const Small = {
	args: { size: 'sm' },
} satisfies Story

export const Large = {
	args: { size: 'lg' },
} satisfies Story
