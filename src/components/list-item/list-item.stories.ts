import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { atRest, inSettingsCard } from '../settings-list/settings-card-frame'
import { ListItem } from './list-item'

const meta = {
	title: 'Components/ListItem',
	component: ListItem,
	argTypes: {
		icon: {
			control: 'text',
			description: '`svg-icon` name of the leading icon; empty for none.',
		},
		label: { control: 'text' },
		supporting: {
			control: 'text',
			description: 'A second line below the label; empty for one line.',
		},
		value: {
			control: 'text',
			description: 'The current value at the trailing edge.',
		},
		caret: { control: 'boolean' },
		href: {
			control: 'text',
			description: 'With an address, the row is a link.',
		},
	},
	args: {
		icon: 'globe',
		label: '言語',
		supporting: '',
		value: '日本語',
		caret: true,
		href: '',
	},
} satisfies Meta<typeof ListItem>

export default meta
type Story = StoryObj<typeof meta>

const ROW =
	'<list-item icon.bind="icon" label.bind="label" supporting.bind="supporting" value.bind="value" caret.bind="caret" href.bind="href" click.trigger="tapped()"></list-item>'

/** The row in a Settings card at a phone's content width (343 px). */
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: inSettingsCard(ROW),
		props: args,
		register: [ListItem],
	})

const px = (value: string) => Number.parseFloat(value)

/** A selector row: icon, label, current value and caret; a tap reaches the parent. */
export const WithValue = {
	args: { tapped: fn() },
	render,
	play: async ({ canvasElement, args }) => {
		const row = within(canvasElement).getByRole('button', {
			name: /言語\s*日本語/,
		})
		const box = row.getBoundingClientRect()
		const style = getComputedStyle(row)
		await expect(box.height).toBeGreaterThanOrEqual(56)
		await expect(style.paddingInlineStart).toBe('16px')
		await expect(style.paddingInlineEnd).toBe('16px')
		const icon = row.querySelector('.list-item-icon') as HTMLElement
		await expect(icon.getBoundingClientRect().width).toBe(24)
		await expect(
			getComputedStyle(row.querySelector('.list-item-label') as Element)
				.fontSize,
		).toBe('16px')
		await expect(
			getComputedStyle(row.querySelector('.list-item-value') as Element)
				.fontSize,
		).toBe('11px')
		await userEvent.click(row)
		await expect(
			(args as unknown as { tapped: () => void }).tapped,
		).toHaveBeenCalledOnce()
		await atRest(userEvent, canvasElement)
		await expectScreenshot(canvasElement, 'list-item-with-value')
	},
} satisfies Story

/** A legal-page row: no icon, no value, a caret only. */
export const CaretOnly = {
	args: { icon: '', label: '利用規約', value: '' },
	render,
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('.list-item-icon')).toBeNull()
		await expect(canvasElement.querySelector('.list-item-value')).toBeNull()
		await expectScreenshot(canvasElement, 'list-item-caret-only')
	},
} satisfies Story

/** The version row: a value and no caret. */
export const ValueOnly = {
	args: { icon: '', label: 'バージョン', value: 'v1.128.1', caret: false },
	render,
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('.list-item-caret')).toBeNull()
		await expectScreenshot(canvasElement, 'list-item-value-only')
	},
} satisfies Story

/** The contact row: a link, not a button. */
export const Link = {
	args: {
		icon: '',
		label: 'お問い合わせ',
		value: '',
		href: 'mailto:support@example.com',
	},
	render,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const link = canvas.getByRole('link', { name: 'お問い合わせ' })
		await expect(link).toHaveAttribute('href', 'mailto:support@example.com')
		await expect(canvas.queryByRole('button')).toBeNull()
	},
} satisfies Story

/** A value too long for the row is cut off; the label keeps its width. */
export const LongValue = {
	args: {
		icon: 'map-pin',
		label: 'エリア',
		value: '北海道札幌市中央区北一条西二丁目 札幌市役所前のあたり',
	},
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Long value"
		const label = canvasElement.querySelector('.list-item-label') as HTMLElement
		const value = canvasElement.querySelector('.list-item-value') as HTMLElement
		const row = canvasElement.querySelector('.list-item') as HTMLElement
		await expect(getComputedStyle(value).textOverflow).toBe('ellipsis')
		await expect(value.scrollWidth).toBeGreaterThan(value.clientWidth)
		// The label is as wide as its text: not cut, not wrapped.
		await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth)
		await expect(label.getBoundingClientRect().height).toBe(24)
		await expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
		await expectScreenshot(canvasElement, 'list-item-long-value')
	},
} satisfies Story

/** A label longer than the row wraps; the value stays visible. */
export const LongLabel = {
	args: {
		icon: 'ticket',
		label: 'ウォルフガング・アマデウス・モーツァルト・フォン・ザルツブルク',
		value: '090-1234-5678',
	},
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Long label"
		const label = canvasElement.querySelector('.list-item-label') as HTMLElement
		const value = canvasElement.querySelector('.list-item-value') as HTMLElement
		const row = canvasElement.querySelector('.list-item') as HTMLElement
		// The value keeps at least 6em (66 px at label-small) and cuts the rest.
		await expect(value.getBoundingClientRect().width).toBeGreaterThanOrEqual(66)
		await expect(getComputedStyle(value).textOverflow).toBe('ellipsis')
		// The label wraps onto a second line instead of pushing the value out.
		await expect(label.getBoundingClientRect().height).toBeGreaterThan(24)
		await expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
	},
} satisfies Story

/** A row with a line of supporting text grows and stays one target. */
export const TwoLines = {
	args: {
		icon: 'chart',
		label: '利用状況の送信',
		supporting: 'どの画面がよく使われているかを匿名で送ります',
		value: '',
	},
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Row with two lines"
		const canvas = within(canvasElement)
		const row = canvas.getByRole('button', { name: /利用状況の送信/ })
		const supporting = row.querySelector('.list-item-supporting') as HTMLElement
		await expect(getComputedStyle(supporting).fontSize).toBe('14px')
		await expect(row.getBoundingClientRect().height).toBeGreaterThan(56)
		await expect(canvas.getAllByRole('button')).toHaveLength(1)
		const rowBox = row.getBoundingClientRect()
		const textBox = supporting.getBoundingClientRect()
		await expect(textBox.bottom).toBeLessThanOrEqual(rowBox.bottom)
		await expectScreenshot(canvasElement, 'list-item-two-lines')
	},
} satisfies Story

/**
 * A Settings row and an All Nearby filter row: the same list item in a
 * Settings card and in a plain list on a sheet's surface.
 */
export const SettingsRowMatchesFilterRow = {
	render: () =>
		defineAureliaStory({
			template: `
				${inSettingsCard('<list-item icon="globe" label="言語" value="日本語" caret.bind="true" data-row="settings"></list-item>')}
				<ul role="list" style="inline-size: 375px; background: var(--md-sys-color-surface-container)">
					<li><list-item icon="map-pin" label="エリア" value="福岡県" caret.bind="true" data-row="filter"></list-item></li>
				</ul>
			`,
			register: [ListItem],
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Settings row and filter row match"
		const row = (name: string) =>
			canvasElement.querySelector(
				`list-item[data-row="${name}"] .list-item`,
			) as HTMLElement
		const [settings, filter] = [row('settings'), row('filter')]
		await expect(settings.getBoundingClientRect().height).toBe(
			filter.getBoundingClientRect().height,
		)
		for (const side of ['paddingInlineStart', 'paddingInlineEnd'] as const) {
			await expect(px(getComputedStyle(settings)[side])).toBe(
				px(getComputedStyle(filter)[side]),
			)
		}
		for (const part of ['.list-item-label', '.list-item-value']) {
			const a = getComputedStyle(settings.querySelector(part) as Element)
			const b = getComputedStyle(filter.querySelector(part) as Element)
			await expect(a.font).toBe(b.font)
			await expect(a.color).toBe(b.color)
		}
	},
} satisfies Story
