import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import {
	ELEVATION_SAMPLES,
	expectEmphasizedOneStepHeavier,
	expectLargerBrowserTextSize,
	expectNamedElevationLevels,
	expectOwnSurface,
	expectSharedStateAndMotion,
	expectTitleAtAnyWidth,
	TYPE_SAMPLES,
} from '../../.storybook/m3-foundations'
import fanTokens from './tokens.css?raw'

/**
 * The Material 3 type styles and elevation levels shared with the organizer
 * console (shared/styles/), rendered with the fan app's tokens.
 */
const meta = {
	title: 'Foundations/M3 Type and Elevation',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const TypeStyles = {
	render: () => defineAureliaStory({ template: TYPE_SAMPLES }),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/design-tokens "Title at any window width"
		await expectTitleAtAnyWidth(canvasElement)
		// @spec components/infrastructure/fan/web/global/design-tokens "Emphasized style is one step heavier"
		expectEmphasizedOneStepHeavier(canvasElement)
		// @spec components/infrastructure/fan/web/global/design-tokens "Larger browser text size"
		expectLargerBrowserTextSize(canvasElement)
	},
} satisfies Story

export const ElevationLevels = {
	render: () => defineAureliaStory({ template: ELEVATION_SAMPLES }),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/design-tokens "A floating surface at a named level"
		expectNamedElevationLevels(canvasElement)
	},
} satisfies Story

export const SharedSystemTokens = {
	// Runs with motion reduced too, where the durations are the reduced ones.
	tags: ['reduced-motion'],
	render: () => defineAureliaStory({ template: TYPE_SAMPLES }),
	play: async () => {
		// @spec components/infrastructure/fan/web/global/design-tokens "One edit applies to both apps"
		expectSharedStateAndMotion(document.documentElement)
		// @spec components/infrastructure/fan/web/global/design-tokens "Colors stay per app"
		expectOwnSurface(document.documentElement, fanTokens)
	},
} satisfies Story

export const HeadingLevels = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:grid; gap:8px; padding:16px; background:var(--md-sys-color-surface); color:var(--md-sys-color-on-surface)">
					<h2 class="md-typescale-title-large" data-sample="sheet-heading">エリアと期間</h2>
					<h3 class="md-typescale-title-large" data-sample="section-heading">チケット</h3>
					<h1 data-sample="plain-heading">Heading with no type style</h1>
					<p data-sample="body">Body text 本文</p>
				</div>
			`,
		}),
	play: async ({ canvasElement }) => {
		const look = (name: string) => {
			const el = canvasElement.querySelector(`[data-sample="${name}"]`)
			if (!el) throw new Error(`no sample ${name}`)
			const s = getComputedStyle(el)
			return [
				s.fontSize,
				s.lineHeight,
				s.fontWeight,
				s.fontFamily,
				s.letterSpacing,
			]
		}
		// @spec components/infrastructure/fan/web/global/design-tokens "Heading level does not decide the look"
		await expect(look('section-heading')).toEqual(look('sheet-heading'))
		// A heading given no type style reads as the text around it, not by level.
		await expect(look('plain-heading')).toEqual(look('body'))
	},
} satisfies Story
