import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import { WelcomeHero } from './welcome-hero'

const meta = {
	title: 'Routes/Welcome/Hero',
	component: WelcomeHero,
	argTypes: {
		hasPreview: {
			control: 'boolean',
			description:
				'A demo is shown below: one button scrolls to it; without one the hero shows the commit actions.',
		},
	},
	args: { hasPreview: true },
	globals: { viewport: { value: 'mobile1', isRotated: false } },
} satisfies Meta<typeof WelcomeHero>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<welcome-hero
			has-preview.bind="hasPreview"
			languages.bind="languages"
			current-locale.bind="current"
			language-select.trigger="current = $event.detail"
		></welcome-hero>`,
		props: {
			hasPreview: args.hasPreview,
			languages: ['ja', 'en'],
			current: 'ja',
		},
		register: [WelcomeHero, BusyOnClickCustomAttribute],
	})

/** With a demo below: the button that scrolls to it, and no commit actions. */
export const WithPreview = {
	render,
	args: { hasPreview: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvasElement.querySelector('[data-testid="welcome-see-preview"]'),
		).not.toBeNull()
		await expect(canvas.queryByTestId('welcome-login')).toBeNull()
	},
} satisfies Story

/** Without a demo: the commit actions in the hero itself. */
export const WithoutPreview = {
	render,
	args: { hasPreview: false },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvasElement.querySelector('[data-testid="welcome-see-preview"]'),
		).toBeNull()
		// @spec components/infrastructure/fan/web/route/welcome "Scroll affordance hidden when preview data is unavailable"
		// (The route hands the hero `has-preview` from whether it has preview
		// data: `dateGroups.length > 0`.)
		const hero = canvasElement.querySelector<HTMLElement>('.welcome-hero')
		await expect(
			hero?.querySelector(
				'.welcome-hero-fallback [data-testid="welcome-get-started"]',
			),
		).not.toBeNull()
		await expect(canvas.getByTestId('welcome-login')).toBeInTheDocument()
		await expect(canvas.getByTestId('welcome-cant-sign-in')).toBeInTheDocument()
	},
} satisfies Story
