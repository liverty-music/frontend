import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ConcertFollowCta } from './concert-follow-cta'

/** Records each Follow press. */
const followed = fn()

const meta = {
	title: 'Components/ConcertFollowCta',
	component: ConcertFollowCta,
	argTypes: {
		followed: { control: 'boolean', description: 'The artist is followed.' },
		updating: { control: 'boolean', description: 'While the follow saves.' },
	},
	args: { followed: false, updating: false },
} satisfies Meta<typeof ConcertFollowCta>

export default meta
type Story = StoryObj<typeof meta>

const SHORT_NAME = 'Vaundy'
const LONG_NAME = 'Hump Back Orchestra and the Midnight Ramblers'

/**
 * The detail sheet's header row on a phone `screen` px wide: the sheet's
 * content and the header take their side padding, and the follow action sits
 * on the right of the artist name.
 */
function render(screen: number, names: readonly string[]): Story['render'] {
	return (args) =>
		defineAureliaStory({
			template: `<div lang="ja" style="inline-size: ${screen}px; padding-inline: calc(var(--space-m) + var(--space-s)); box-sizing: border-box; background: var(--md-sys-color-surface-container)">
				${names
					.map(
						(name, i) => `<div class="sheet-artist-row" data-testid="row-${i}">
					<h2 class="[ sheet-artist-name ] [ md-typescale-headline-small ]">${name}</h2>
					<div
						as-element="concert-follow-cta"
						class="sheet-follow"
						followed.bind="followed"
						updating.bind="updating"
						follow.trigger="onFollow()"
					></div>
				</div>`,
					)
					.join('')}
			</div>`,
			props: { ...args, onFollow: followed },
			register: [ConcertFollowCta],
		})
}

/** The name and the action share the row's top edge, the action on the right. */
function expectBesideName(row: HTMLElement, action: HTMLElement): void {
	const name = row.querySelector('.sheet-artist-name') as HTMLElement
	const nameBox = name.getBoundingClientRect()
	const actionBox = action.getBoundingClientRect()
	expect(actionBox.left).toBeGreaterThanOrEqual(nameBox.right)
	expect(Math.abs(actionBox.top - nameBox.top)).toBeLessThanOrEqual(8)
	expect(actionBox.right).toBeLessThanOrEqual(
		row.getBoundingClientRect().right + 0.5,
	)
}

/** A 320 px wide screen: 「Follow」 on the right of the name; a press reports `follow`. */
export const NotFollowedAt320 = {
	render: render(320, [SHORT_NAME]),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const button = canvas.getByRole('button', { name: 'Follow' })
		// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow button visible for unfollowed artist in Concerts view context"
		expectBesideName(canvas.getByTestId('row-0'), button)
		await userEvent.click(button)
		await expect(followed).toHaveBeenCalled()
	},
} satisfies Story

/** A 412 px wide screen (a common Android width). */
export const NotFollowedAt412 = {
	render: render(412, [SHORT_NAME]),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow button visible for unfollowed artist in Concerts view context"
		expectBesideName(
			canvas.getByTestId('row-0'),
			canvas.getByRole('button', { name: 'Follow' }),
		)
	},
} satisfies Story

/**
 * A name too long for one line beside the button on a 320 px screen wraps;
 * the button keeps the size it has beside a short name.
 */
export const LongArtistName = {
	render: render(320, [SHORT_NAME, LONG_NAME]),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const [short, long] = canvas.getAllByRole('button', { name: 'Follow' })
		const longRow = canvas.getByTestId('row-1')
		const name = longRow.querySelector('.sheet-artist-name') as HTMLElement
		const lineHeight = Number.parseFloat(getComputedStyle(name).lineHeight)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Long artist name"
		expect(name.getBoundingClientRect().height).toBeGreaterThan(
			lineHeight * 1.5,
		)
		expect(long.getBoundingClientRect().width).toBeCloseTo(
			short.getBoundingClientRect().width,
			0,
		)
		expect(long.getBoundingClientRect().height).toBeCloseTo(
			short.getBoundingClientRect().height,
			0,
		)
		expectBesideName(longRow, long)
	},
} satisfies Story

/** Followed from this sheet: the static 「Following」 in the brand colour. */
export const Followed = {
	render: render(412, [SHORT_NAME]),
	args: { followed: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const state = canvas.getByTestId('discovery-concerts-following')
		await expect(state).toBeVisible()
		await expect(state).toHaveTextContent('Following')
		await expect(canvas.queryByRole('button')).toBeNull()
	},
} satisfies Story

/** The follow is being saved: the Follow button waits and a press does nothing. */
export const Saving = {
	render: render(412, [SHORT_NAME]),
	args: { updating: true },
	play: async ({ canvasElement }) => {
		followed.mockClear()
		const button = within(canvasElement).getByRole('button')
		await expect(button).toBeDisabled()
		await userEvent.click(button)
		await expect(followed).not.toHaveBeenCalled()
	},
} satisfies Story
