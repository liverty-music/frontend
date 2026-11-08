import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect, waitFor } from 'storybook/test'
import { resolveColor } from '../../../.storybook/contrast'
import { IOnboardingService } from '../../services/onboarding-service'
import { PageHelp } from './page-help'

const meta = {
	title: 'Components/PageHelp',
	component: PageHelp,
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

		// @spec components/infrastructure/fan/web/global/page-help "Sheet background, title font, and muted text rendering"
		const sheetBody = doc.querySelector<HTMLElement>('bottom-sheet .sheet-body')
		if (!sheetBody) throw new Error('no sheet body')
		await expect(getComputedStyle(sheetBody).backgroundColor).toBe(
			resolveColor(sheetBody, 'var(--md-sys-color-surface-container-high)'),
		)
		const title = doc.querySelector<HTMLElement>('.help-section-title')
		if (!title) throw new Error('no section title')
		await expect(
			getComputedStyle(title).fontFamily.startsWith('Righteous'),
		).toBe(true)
		await expect(getComputedStyle(title).fontSize).toBe('24px')
		const note = doc.querySelector<HTMLElement>('.page-help-note')
		if (!note) throw new Error('no note')
		await expect(getComputedStyle(note).color).toBe(
			resolveColor(note, 'var(--md-sys-color-on-surface-variant)'),
		)
		await expect(getComputedStyle(note).opacity).toBe('1')

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
