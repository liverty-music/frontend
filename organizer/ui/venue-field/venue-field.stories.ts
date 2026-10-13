import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import { canvasOf, consoleStoryParameters, deepQuery } from '../story-support'
import { VenueField, type VenuePick } from './venue-field'

const meta = {
	title: 'Console/VenueField',
	component: VenueField,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		label: { control: 'text' },
		error: { control: 'text' },
		required: { control: 'boolean' },
	},
	args: { label: '会場', error: '', required: true },
} satisfies Meta<typeof VenueField>

export default meta
type Story = StoryObj<typeof meta>

const HANEDA: VenuePick = {
	placeId: 'ChIJ-haneda',
	name: 'Zepp Haneda (TOKYO)',
	address: '東京都大田区羽田空港1-1-4',
}

const renderWith =
	(
		search: (text: string) => Promise<VenuePick[]>,
		value: VenuePick | null = null,
	): Story['render'] =>
	(args) =>
		defineAureliaStory({
			template: `
				<div style="inline-size:390px; padding:16px; background:var(--md-color-surface)">
					<venue-field label.bind="label" error.bind="error" required.bind="required" search.bind="search" value.bind="value"></venue-field>
					<p data-testid="value">\${value ? value.placeId : 'none'}</p>
				</div>
			`,
			props: { ...args, search, value },
		})

async function searchFor(root: HTMLElement, text: string): Promise<void> {
	const canvas = canvasOf(root)
	await userEvent.fill(canvas.getByRole('searchbox', { name: /会場/ }), text)
	await userEvent.click(canvas.getByRole('button', { name: '会場を検索' }))
}

export const PickAVenue = {
	render: renderWith(async () => [
		HANEDA,
		{
			placeId: 'ChIJ-other',
			name: 'Zepp DiverCity (TOKYO)',
			address: '東京都江東区青海1-1-10',
		},
	]),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await searchFor(canvasElement, 'Zepp Haneda')
		await userEvent.click(
			await waitFor(() =>
				canvas.getByRole('radio', { name: /Zepp Haneda \(TOKYO\)/ }).element(),
			),
		)

		await expect(canvas.getByTestId('value').element()).toHaveTextContent(
			'ChIJ-haneda',
		)
		await expect(
			canvas.getByText('Zepp Haneda (TOKYO)').element(),
		).toBeVisible()
		await expect(
			canvas.getByText('東京都大田区羽田空港1-1-4').element(),
		).toBeVisible()
	},
} satisfies Story

export const NoMatch = {
	render: renderWith(async () => []),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await searchFor(canvasElement, 'どこにもない会場')
		await waitFor(() =>
			expect(deepQuery(canvasElement, '[role="status"]')).toHaveTextContent(
				'会場が見つかりませんでした',
			),
		)
		await expect(canvas.getByTestId('value').element()).toHaveTextContent(
			'none',
		)
	},
} satisfies Story

export const SearchUnavailable = {
	render: renderWith(async () => {
		throw new Error('Unavailable')
	}),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await searchFor(canvasElement, 'Zepp Haneda')
		await waitFor(() =>
			expect(deepQuery(canvasElement, '[role="status"]')).toHaveTextContent(
				'会場を検索できません',
			),
		)
		await expect(
			canvas.getByRole('button', { name: '再試行' }).element(),
		).toBeVisible()
		await expect(canvas.getByTestId('value').element()).toHaveTextContent(
			'none',
		)
	},
} satisfies Story

export const Picked = {
	render: renderWith(async () => [], HANEDA),
} satisfies Story

export const NotPicked = {
	args: { error: '検索結果から会場を選んでください' },
	render: renderWith(async () => []),
	play: async ({ canvasElement }) => {
		await expect(
			canvasOf(canvasElement)
				.getByRole('searchbox', { name: /会場/ })
				.element(),
		).toHaveAttribute('aria-invalid', 'true')
	},
} satisfies Story
