import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import {
	ELEVATION_SAMPLES,
	expectEmphasizedOneStepHeavier,
	expectLargerBrowserTextSize,
	expectNamedElevationLevels,
	expectTitleAtAnyWidth,
	TYPE_SAMPLES,
} from '../../.storybook/m3-foundations'

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
