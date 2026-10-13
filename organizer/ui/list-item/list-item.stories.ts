import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { canvasOf, consoleStoryParameters } from '../story-support'
import { ListItem } from './list-item'

const meta = {
	title: 'Console/ListItem',
	component: ListItem,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		href: {
			control: 'text',
			description: 'With an address, the whole item is one link.',
		},
	},
} satisfies Meta<typeof ListItem>

export default meta
type Story = StoryObj<typeof meta>

const frame = (items: string) => `
	<div style="inline-size:390px; background:var(--md-color-surface); color:var(--md-color-on-surface)">
		<ul aria-label="公演" style="margin:0; padding:0; list-style:none">${items}</ul>
	</div>
`

/** A single-action item: headline, supporting lines, trailing status, one link. */
export const SingleAction = {
	render: () =>
		defineAureliaStory({
			template: frame(`
				<li>
					<list-item href="#tour">
						<span slot="overline">ツアー · Band A</span>
						XX Tour 2026
						<span slot="supporting">11月3日(火) 他 3公演 · Zepp Haneda 他</span>
						<span slot="supporting">受付中</span>
						<span slot="trailing"><status-badge tone="success" label="公開中"></status-badge></span>
					</list-item>
				</li>
			`),
		}),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		const links = canvas.getByRole('link').elements()
		await expect(links).toHaveLength(1)
		await expect(canvas.getByRole('button').query()).toBeNull()
		const link = canvas.getByRole('link').element()
		await expect(link).toHaveAttribute('href', '#tour')
		// The whole item is the target.
		const item = canvasElement.querySelector('li')?.getBoundingClientRect()
		const box = link.getBoundingClientRect()
		await expect(box.width).toBe(item?.width)
		await expect(box.height).toBeGreaterThanOrEqual(88)
		await expect(
			canvas
				.getByRole('link', { name: /XX Tour 2026.*受付中.*公開中/ })
				.element(),
		).toBeVisible()
	},
} satisfies Story

/** One line with trailing text: a Home item and its action word. */
export const OneLine = {
	render: () =>
		defineAureliaStory({
			template: frame(`
				<li>
					<list-item href="#payout">
						入金口座の登録が終わっていません
						<span slot="trailing">登録する<console-icon name="chevron-right"></console-icon></span>
					</list-item>
				</li>
			`),
		}),
	play: async ({ canvasElement }) => {
		const link = canvasOf(canvasElement).getByRole('link').element()
		await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(56)
	},
} satisfies Story

/**
 * A multi-action item: its content is not a link, and its actions sit at the
 * trailing edge (a scanner's copy button and overflow menu).
 */
export const MultiAction = {
	render: () =>
		defineAureliaStory({
			template: frame(`
				<li>
					<list-item>
						受付2
						<span slot="supporting"><status-badge tone="success" label="未使用"></status-badge></span>
						<span slot="supporting">https://reception.liverty-music.app/#token-2</span>
						<span slot="trailing">
							<copy-button label="受付2" value="https://reception.liverty-music.app/#token-2"></copy-button>
							<overflow-menu items.bind="items"></overflow-menu>
						</span>
					</list-item>
				</li>
			`),
			props: {
				items: [
					{ id: 'revoke', labelKey: 'reception.revoke' },
					{ id: 'reissue', labelKey: 'reception.revokeAndReissue' },
				],
			},
		}),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await expect(canvas.getByRole('link').query()).toBeNull()
		await expect(
			canvas.getByRole('button', { name: '受付2をコピー' }).element(),
		).toBeVisible()
		await expect(
			canvas.getByRole('button', { name: 'その他の操作' }).element(),
		).toBeVisible()
	},
} satisfies Story
