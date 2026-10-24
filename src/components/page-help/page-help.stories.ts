import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect, waitFor } from 'storybook/test'
import { IOnboardingService } from '../../services/onboarding-service'
import { PageHelp } from './page-help'

const meta = {
	title: 'Components/PageHelp',
	component: PageHelp,
	tags: ['test', 'autodocs'],
} satisfies Meta<typeof PageHelp>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The My Artists help sheet, opened as on a first visit during onboarding.
 * Its hype tiers sit on one shared 3-column grid.
 */
export const MyArtists = {
	// The shared bottom sheet's scroll area is not focusable when its content
	// has no focusable element (the help text has none). That gap belongs to
	// the bottom sheet, not to this grid; it is filed separately.
	parameters: {
		a11y: {
			config: {
				rules: [{ id: 'scrollable-region-focusable', enabled: false }],
			},
		},
	},
	render: () =>
		defineAureliaStory({
			template: '<page-help page="my-artists"></page-help>',
			register: [PageHelp],
			items: [
				Registration.instance(IOnboardingService, { isOnboarding: true }),
			],
		}),
	play: async ({ canvasElement }) => {
		localStorage.clear()
		const doc = canvasElement.ownerDocument
		const rows = await waitFor(() => {
			const found = [
				...doc.querySelectorAll<HTMLElement>('.help-hype-grid > li'),
			]
			if (found.length !== 4 || found[0].getBoundingClientRect().width === 0) {
				throw new Error('help sheet not open yet')
			}
			return found
		})
		const edges = (selector: string, side: 'left' | 'right') =>
			new Set(
				rows.map((li) =>
					Math.round(
						(li.querySelector(selector) as HTMLElement).getBoundingClientRect()[
							side
						],
					),
				),
			)

		// @spec components/infrastructure/fan/web/global/page-help "Column alignment"
		await expect(edges('.help-hype-icon', 'right').size).toBe(1)
		await expect(edges('.help-hype-label', 'left').size).toBe(1)
		await expect(edges('.help-hype-label', 'right').size).toBe(1)
		await expect(edges('.help-hype-desc', 'left').size).toBe(1)
		// Each row stays a list item for assistive technology.
		for (const li of rows) {
			await expect(getComputedStyle(li).display).not.toBe('contents')
		}
	},
} satisfies Story
