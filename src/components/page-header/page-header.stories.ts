import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { PageHeader } from './page-header'

const meta = {
	title: 'Components/PageHeader',
	component: PageHeader,
	tags: ['test', 'autodocs'],
	argTypes: {
		titleKey: {
			control: 'text',
			description: 'i18n key resolved into the H1 via the `t` binding.',
		},
		showSettings: {
			control: 'boolean',
			description: 'Shows the Settings gear (the shell sets it on tab pages).',
		},
	},
	args: { titleKey: 'entity.artist.label', showSettings: false },
} satisfies Meta<typeof PageHeader>

export default meta
type Story = StoryObj<typeof meta>

// Title only — the H1 resolves the i18n key.
export const Default = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByRole('heading', { level: 1 })).toBeInTheDocument()
		// Component-level visual regression against a committed baseline (D4/OQ2).
		await expectScreenshot(canvasElement, 'page-header-default')
	},
} satisfies Story

// A different key demonstrates the binding is data-driven.
export const ConcertsTitle = {
	args: { titleKey: 'entity.concert.label' },
} satisfies Story

// With projected trailing content (e.g. a filter control) alongside the title.
export const WithSlottedAction = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<page-header title-key.bind="titleKey">
					<button type="button">Filter</button>
				</page-header>
			`,
			props: args,
			register: [PageHeader],
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByRole('button', { name: 'Filter' }),
		).toBeInTheDocument()
	},
} satisfies Story

// The Settings gear the shell shows on the four tab pages, after any projected
// trailing content.
export const WithSettings = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<page-header title-key.bind="titleKey" show-settings.bind="true">
					<button type="button">Filter</button>
				</page-header>
			`,
			props: args,
			register: [PageHeader],
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const gear = canvas.getByRole('link', { name: 'Settings' })
		await expect(gear.getAttribute('href')).toBe('settings')
		// @spec components/infrastructure/fan/web/global/page-header "Gear after a route's own trailing content"
		const trailing = canvas.getByRole('button', { name: 'Filter' })
		await expect(
			trailing.compareDocumentPosition(gear) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
		await expectScreenshot(canvasElement, 'page-header-with-settings')
	},
} satisfies Story
