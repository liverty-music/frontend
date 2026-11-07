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
import { consoleStoryParameters } from '../ui/story-support'
import sharedStyles from './shared.css?inline'

/**
 * The Material 3 type styles and elevation levels shared with the fan app
 * (shared/styles/), rendered with the console's tokens. The samples sit in a
 * shadow root given `shared.css`, as every console component is, so the type
 * classes are checked where console components use them.
 */
const meta = {
	title: 'Console/Foundations/M3 Type and Elevation',
	parameters: consoleStoryParameters,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** A shadow root holding `markup`, with the console's shared rules adopted. */
function consoleShadowRoot(canvasElement: HTMLElement, markup: string) {
	const host = document.createElement('div')
	canvasElement.append(host)
	const root = host.attachShadow({ mode: 'open' })
	const sheet = new CSSStyleSheet()
	sheet.replaceSync(sharedStyles)
	root.adoptedStyleSheets = [sheet]
	root.innerHTML = markup
	return root
}

export const TypeStyles = {
	render: () => defineAureliaStory({ template: '' }),
	play: async ({ canvasElement }) => {
		const root = consoleShadowRoot(canvasElement, TYPE_SAMPLES)
		// @spec components/infrastructure/organizer/web/global/design-tokens "Title at any window width"
		await expectTitleAtAnyWidth(root)
		// @spec components/infrastructure/organizer/web/global/design-tokens "Emphasized style is one step heavier"
		expectEmphasizedOneStepHeavier(root)
		// @spec components/infrastructure/organizer/web/global/design-tokens "Larger browser text size"
		expectLargerBrowserTextSize(root)
	},
} satisfies Story

export const ElevationLevels = {
	render: () => defineAureliaStory({ template: '' }),
	play: async ({ canvasElement }) => {
		const root = consoleShadowRoot(canvasElement, ELEVATION_SAMPLES)
		// @spec components/infrastructure/organizer/web/global/design-tokens "A floating surface at a named level"
		expectNamedElevationLevels(root)
	},
} satisfies Story
