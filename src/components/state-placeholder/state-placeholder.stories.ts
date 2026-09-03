import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { expect as vitestExpect } from 'vitest'
import { StatePlaceholder } from './state-placeholder'

const meta = {
	title: 'Components/StatePlaceholder',
	component: StatePlaceholder,
	tags: ['test', 'autodocs'],
	argTypes: {
		icon: {
			control: 'text',
			description:
				'Optional `svg-icon` name shown above the projected content.',
		},
	},
	args: { icon: 'bell' },
} satisfies Meta<typeof StatePlaceholder>

export default meta
type Story = StoryObj<typeof meta>

// Empty state with an icon and projected copy.
export const Empty = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<state-placeholder icon.bind="icon">
					<p>まだフォローしているアーティストがいません</p>
				</state-placeholder>
			`,
			props: args,
			register: [StatePlaceholder],
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByText('まだフォローしているアーティストがいません'),
		).toBeInTheDocument()
		// Component-level visual regression against a committed baseline (D4/OQ2).
		await vitestExpect
			.element(canvasElement)
			.toMatchScreenshot('state-placeholder-empty', {
				comparatorName: 'pixelmatch',
				comparatorOptions: { allowedMismatchedPixelRatio: 0.001 },
			})
	},
} satisfies Story

// Without an icon, only the projected content renders.
export const NoIcon = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<state-placeholder icon.bind="icon">
					<p>該当するライブが見つかりませんでした</p>
				</state-placeholder>
			`,
			props: args,
			register: [StatePlaceholder],
		}),
	args: { icon: '' },
} satisfies Story
