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
		loading: {
			control: 'boolean',
			description:
				'Loading/skeleton variant: renders layout-preserving skeleton bars instead of the icon + projected content.',
		},
		rows: {
			control: 'number',
			description: 'Number of skeleton bars rendered in the loading variant.',
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

// Loading/skeleton variant — layout-preserving shimmer bars (the M3 skeleton
// primitive). Exercises the global `.skeleton` utility (shimmer + tokens),
// which only renders because the preview loads the global style layer.
export const Loading = {
	render: (args) =>
		defineAureliaStory({
			template: `<state-placeholder loading.bind="loading" rows.bind="rows"></state-placeholder>`,
			props: args,
			register: [StatePlaceholder],
		}),
	args: { loading: true, rows: 3 },
	play: async ({ canvasElement }) => {
		// Skeleton bars are present and match the requested row count. No visual
		// screenshot here: the `.skeleton` shimmer animates (background-position),
		// so a pixel baseline would be non-deterministic/flaky. Layout + a11y are
		// asserted instead; axe (via the shared annotations) covers contrast.
		const bars = canvasElement.querySelectorAll('.skeleton.skeleton-row')
		vitestExpect(bars.length).toBe(3)
	},
} satisfies Story
