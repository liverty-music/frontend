import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { resolveColor } from '../../../.storybook/contrast'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { PageHeader } from './page-header'

const meta = {
	title: 'Components/PageHeader',
	component: PageHeader,
	argTypes: {
		titleKey: {
			control: 'text',
			description: 'i18n key resolved into the H1 via the `t` binding.',
		},
	},
	args: { titleKey: 'entity.artist.label' },
} satisfies Meta<typeof PageHeader>

export default meta
type Story = StoryObj<typeof meta>

// Title only — the H1 resolves the i18n key.
export const Default = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const h1 = canvas.getByRole('heading', { level: 1 })
		await expect(h1).toBeInTheDocument()

		// @spec components/infrastructure/fan/web/global/page-header "Visual consistency across routes"
		// Every route renders this one component, so each shares what it sets:
		// the headline-small title, the --space-xs padding, the 10 % white
		// border and the surface-container background (with its brand tint).
		const header = canvasElement.querySelector(
			'page-header header',
		) as HTMLElement
		const head = getComputedStyle(h1)
		await expect([head.fontSize, head.lineHeight, head.fontWeight]).toEqual([
			'24px',
			'32px',
			'400',
		])
		await expect(head.fontFamily.startsWith('Righteous')).toBe(true)
		const box = getComputedStyle(header)
		const spaceXs = getComputedStyle(document.documentElement)
			.getPropertyValue('--space-xs')
			.trim()
		const probe = document.createElement('div')
		probe.style.paddingBlock = spaceXs
		canvasElement.append(probe)
		await expect(box.paddingBlockStart).toBe(
			getComputedStyle(probe).paddingBlockStart,
		)
		probe.remove()
		await expect(box.borderBottomWidth).toBe('1px')
		await expect(box.backgroundImage).toContain(
			resolveColor(header, 'var(--md-sys-color-surface-container)'),
		)
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
