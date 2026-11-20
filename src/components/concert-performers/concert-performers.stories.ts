import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { ConcertPerformers, type Performer } from './concert-performers'

const meta = {
	title: 'Components/ConcertPerformers',
	component: ConcertPerformers,
	argTypes: {
		followsLoaded: {
			control: 'boolean',
			description: "False until the fan's follows are known.",
		},
		updatingId: {
			control: 'text',
			description: 'The performer whose follow is being saved, or empty.',
		},
	},
	args: { followsLoaded: true, updatingId: '' },
} satisfies Meta<typeof ConcertPerformers>

export default meta
type Story = StoryObj<typeof meta>

const PERFORMERS: Performer[] = [
	{ id: 'a1', name: 'VAUNDY' },
	{ id: 'a2', name: 'Mrs. GREEN APPLE' },
]

function story(followed: string[]): Story['render'] {
	return (args) =>
		defineAureliaStory({
			template: `<div style="inline-size: 360px">
				<concert-performers
					performers.bind="performers"
					followed-ids.bind="followedIds"
					follows-loaded.bind="followsLoaded"
					updating-id.bind="updatingId"
				></concert-performers>
			</div>`,
			props: {
				...args,
				performers: PERFORMERS,
				followedIds: new Set(followed),
			},
			register: [ConcertPerformers],
		})
}

/** No performer followed yet: every button offers to follow. */
export const NotFollowed = {
	render: story([]),
	play: async ({ canvasElement }) => {
		const buttons = within(canvasElement).getAllByTestId('event-follow')
		await expect(buttons).toHaveLength(2)
		for (const b of buttons) {
			await expect(b).toHaveAttribute('aria-pressed', 'false')
		}
	},
} satisfies Story

/** The first performer is followed: its button is filled and pressed. */
export const Followed = {
	render: story(['a1']),
	play: async ({ canvasElement }) => {
		const [first, second] = within(canvasElement).getAllByTestId('event-follow')
		await expect(first).toHaveAttribute('aria-pressed', 'true')
		await expect(first).toHaveAttribute('data-followed', 'true')
		await expect(second).toHaveAttribute('aria-pressed', 'false')
	},
} satisfies Story

/** A follow is being saved: that performer's button waits. */
export const Saving = {
	render: story([]),
	args: { updatingId: 'a2' },
	play: async ({ canvasElement }) => {
		const [first, second] = within(canvasElement).getAllByTestId('event-follow')
		await expect(first).toBeEnabled()
		await expect(second).toBeDisabled()
	},
} satisfies Story

/** The fan's follows are not known yet: every button waits. */
export const FollowsLoading = {
	render: story([]),
	args: { followsLoaded: false },
	play: async ({ canvasElement }) => {
		const buttons = within(canvasElement).getAllByTestId('event-follow')
		await expect(buttons).toHaveLength(2)
		for (const b of buttons) {
			await expect(b).toBeDisabled()
		}
	},
} satisfies Story
