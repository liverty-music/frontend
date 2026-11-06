import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement } from 'aurelia'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { NearbyFilterSheet } from './nearby-filter-sheet'

const meta = {
	title: 'Components/AllNearby/NearbyFilterSheet',
	component: NearbyFilterSheet,
	argTypes: {
		areaName: { control: 'text', description: 'The area row’s value.' },
		periodLabel: { control: 'text', description: 'The period row’s value.' },
	},
} satisfies Meta<typeof NearbyFilterSheet>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<nearby-filter-sheet area-name.bind="areaName" period-label.bind="periodLabel"></nearby-filter-sheet>`,
		props: args,
		register: [NearbyFilterSheet],
	})

/**
 * Opens the sheet, checks both rows show their values, then taps the area row:
 * the sheet closes and reports the row only once it has finished closing
 * (which also lifts the sheet's inert from the page for the next story).
 */
function play(area: string, period: string): Story['play'] {
	return async ({ canvasElement }) => {
		const host = canvasElement.querySelector('nearby-filter-sheet')
		if (!host) throw new Error('not rendered')
		CustomElement.for<NearbyFilterSheet>(host).viewModel.open()
		const canvas = within(canvasElement)
		const areaRow = canvas.getByRole('button', {
			name: new RegExp(`エリア\\s*${area}`),
		})
		const periodRow = canvas.getByRole('button', {
			name: new RegExp(`期間\\s*${period}`),
		})
		await waitFor(() => {
			expect(areaRow).toBeVisible()
			expect(periodRow).toBeVisible()
		})

		let chosen = ''
		host.addEventListener('filter-row-chosen', (e) => {
			chosen = (e as CustomEvent<string>).detail
		})
		await userEvent.click(areaRow)
		// @spec components/infrastructure/fan/web/route/discovery "A row opens its selector"
		await waitFor(() => expect(chosen).toBe('area'), { timeout: 2000 })
	}
}

/** The fan's home area and 7日以内: the defaults. */
export const Default = {
	render,
	args: { areaName: '福岡県', periodLabel: '7日以内' },
	play: play('福岡県', '7日以内'),
} satisfies Story

/** Another area than home, and a preset other than 7日以内. */
export const OverrideSet = {
	render,
	args: { areaName: '大阪府', periodLabel: '今週末' },
	play: play('大阪府', '今週末'),
} satisfies Story

/** A custom range shows as a localized range. */
export const CustomRange = {
	render,
	args: { areaName: '福岡県', periodLabel: '8/12〜8/20' },
	play: play('福岡県', '8/12〜8/20'),
} satisfies Story

/** A guest without a home area is asked to choose one. */
export const NoArea = {
	render,
	args: { areaName: '', periodLabel: '7日以内' },
	play: play('エリアを選ぶ', '7日以内'),
} satisfies Story
