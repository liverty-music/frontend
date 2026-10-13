import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import {
	canvasOf,
	consoleStoryParameters,
	deepQueryAll,
} from '../story-support'
import { type DataColumn, DataList, type DataRow } from './data-list'

const meta = {
	title: 'Console/DataList',
	component: DataList,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
} satisfies Meta<typeof DataList>

export default meta
type Story = StoryObj<typeof meta>

const columns: DataColumn[] = [
	{ key: 'title', labelKey: 'concerts.column.title', primary: true },
	{ key: 'state', labelKey: 'concert.column.state', kind: 'status' },
	{ key: 'startsAt', labelKey: 'concertEditor.startTime', kind: 'datetime' },
	{ key: 'schedule', labelKey: 'concerts.column.schedule' },
	{ key: 'entries', labelKey: 'sale.stats.entries', kind: 'count' },
	{ key: 'price', labelKey: 'lotteryEditor.price', kind: 'yen' },
]

const rows: DataRow[] = [
	{
		id: 'e1',
		href: '#e1',
		subtitle: [{ key: 'seriesType.tour' }, 'Band A'],
		cells: {
			title: 'XX Tour 2026 東京',
			state: { tone: 'success', labelKey: 'publishState.published' },
			startsAt: new Date('2026-11-03T09:00:00Z'),
			schedule: [
				{
					key: 'concerts.moreDates',
					params: { day: new Date('2026-11-03T09:00:00Z'), count: 2 },
				},
				'Zepp Haneda',
			],
			entries: 412,
			price: 6500,
		},
	},
	{
		id: 'e2',
		href: '#e2',
		cells: {
			title: 'XX Tour 2026 大阪',
			state: { tone: 'neutral', labelKey: 'publishState.draft' },
			startsAt: new Date('2026-11-10T09:00:00Z'),
			schedule: 'Zepp Osaka Bayside',
			entries: 1380,
			price: 7000,
		},
	},
]

const renderAt =
	(width: number): Story['render'] =>
	() =>
		defineAureliaStory({
			template: `<div style="inline-size:${width}px; padding:16px; background:var(--md-color-surface)"><data-list columns.bind="columns" rows.bind="rows" label="公演"></data-list></div>`,
			props: { columns, rows },
		})

export const Cards = {
	render: renderAt(390),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		const list = canvas.getByRole('list', { name: '公演' })
		await expect(list.element()).toBeVisible()
		await expect(canvas.getByRole('table').query()).toBeNull()
		// The hidden table holds the same text; query the cards only.
		await expect(
			list.getByRole('link', { name: 'XX Tour 2026 東京' }).element(),
		).toBeVisible()
		await expect(
			list.getByText('11月3日(火) 18:00 JST').element(),
		).toBeVisible()
		await expect(list.getByText('6,500円').element()).toBeVisible()
		// Column titles, statuses and catalog texts are translated by the list.
		await expect(list.getByText('公開中').element()).toBeVisible()
		await expect(list.getByText('ツアー · Band A').element()).toBeVisible()
		await expect(
			list.getByText('11月3日(火) 他 2公演 · Zepp Haneda').element(),
		).toBeVisible()
		await expect(list.getByText('日程・会場').first().element()).toBeVisible()
	},
} satisfies Story

export const Table = {
	render: renderAt(1000),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await expect(
			canvas.getByRole('table', { name: '公演' }).element(),
		).toBeVisible()
		await expect(canvas.getByRole('list', { name: '公演' }).query()).toBeNull()
		await expect(canvas.getByRole('row').elements()).toHaveLength(3)
		await expect(
			canvas.getByRole('rowheader', { name: 'XX Tour 2026 大阪' }).element(),
		).toBeVisible()

		// @spec components/infrastructure/organizer/web/global/design-tokens "Counts line up"
		const entries = deepQueryAll(canvasElement, 'tbody td:nth-child(5) data')
		await expect(entries.map((e) => e.textContent?.trim())).toEqual([
			'412',
			'1,380',
		])
		await expect(entries[0].getBoundingClientRect().right).toBeCloseTo(
			entries[1].getBoundingClientRect().right,
			0,
		)
		const cells = deepQueryAll(canvasElement, 'td[data-numeric="true"]')
		for (const cell of cells) {
			await expect(getComputedStyle(cell).textAlign).toBe('end')
			await expect(getComputedStyle(cell).fontVariantNumeric).toContain(
				'tabular-nums',
			)
		}
	},
} satisfies Story

export const Empty = {
	render: () =>
		defineAureliaStory({
			template: `<div style="inline-size:390px; padding:16px; background:var(--md-color-surface)"><data-list columns.bind="columns" rows.bind="rows" label="公演"></data-list></div>`,
			props: { columns, rows: [] },
		}),
} satisfies Story
