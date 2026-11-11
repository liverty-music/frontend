import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
import { EventFollowCta } from './event-follow-cta'

/** Records each Follow press. */
const followed = fn()

const meta = {
	title: 'Components/EventFollowCta',
	component: EventFollowCta,
	argTypes: {
		followed: { control: 'boolean', description: 'The artist is followed.' },
		updating: { control: 'boolean', description: 'While the follow saves.' },
	},
	args: { followed: false, updating: false },
} satisfies Meta<typeof EventFollowCta>

export default meta
type Story = StoryObj<typeof meta>

/** On the detail sheet's surface, as wide as the sheet's content on a phone. */
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="inline-size: 328px; background: var(--md-sys-color-surface-container)">
			<section
				as-element="event-follow-cta"
				class="sheet-follow"
				followed.bind="followed"
				updating.bind="updating"
				follow.trigger="onFollow()"
			></section>
		</div>`,
		props: { ...args, onFollow: followed },
		register: [EventFollowCta],
	})

/** Not followed: the full-width Follow button; a press reports `follow`. */
export const NotFollowed = {
	render,
	play: async ({ canvasElement }) => {
		await userEvent.click(within(canvasElement).getByRole('button'))
		await expect(followed).toHaveBeenCalled()
	},
} satisfies Story

/** Followed: the static "Following" line in the brand colour. */
export const Followed = {
	render,
	args: { followed: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByTestId('all-nearby-following')).toBeVisible()
		await expect(canvas.queryByRole('button')).toBeNull()
	},
} satisfies Story
