import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import {
	CONTRAST_SAMPLES,
	ELEVATION_SAMPLES,
	expectContrastLevel,
	expectEmphasizedOneStepHeavier,
	expectLargerBrowserTextSize,
	expectNamedElevationLevels,
	expectOwnSurface,
	expectSharedStateAndMotion,
	expectSpacingAtAnyWidth,
	expectTitleAtAnyWidth,
	spacingSamples,
	TYPE_SAMPLES,
} from '../../.storybook/m3-foundations'
import { consoleStoryParameters } from '../ui/story-support'
import sharedStyles from './shared.css?inline'
import consoleTokens from './tokens.css?raw'

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

export const SpacingSteps = {
	render: () => defineAureliaStory({ template: '' }),
	play: async ({ canvasElement }) => {
		// Inside a console shadow root, where the console's spacing applies.
		const root = consoleShadowRoot(canvasElement, spacingSamples())
		// @spec components/infrastructure/organizer/web/global/design-tokens "Same spacing on any width"
		await expectSpacingAtAnyWidth(root)
	},
} satisfies Story

export const SharedSystemTokens = {
	// Runs with motion reduced too, where the durations are the reduced ones.
	tags: ['reduced-motion'],
	render: () => defineAureliaStory({ template: '' }),
	play: async ({ canvasElement }) => {
		// Read inside a console shadow root, where every console component renders.
		const root = consoleShadowRoot(canvasElement, '<p>console</p>')
		const inside = root.querySelector('p')
		if (!inside) throw new Error('no element in the shadow root')
		// @spec components/infrastructure/fan/web/global/design-tokens "One edit applies to both apps"
		expectSharedStateAndMotion(inside)
		// @spec components/infrastructure/fan/web/global/design-tokens "Colors stay per app"
		expectOwnSurface(inside, consoleTokens)
	},
} satisfies Story

/**
 * Secondary text and boundaries on every surface tier, in a console shadow
 * root. Runs in the default project and, tagged `more-contrast`, in a browser
 * context that asks for more contrast (`storybook-more-contrast`).
 */
export const ContrastLevel = {
	tags: ['more-contrast'],
	render: () => defineAureliaStory({ template: '' }),
	play: async ({ canvasElement, globals }) => {
		const root = consoleShadowRoot(canvasElement, CONTRAST_SAMPLES)
		// @spec components/infrastructure/organizer/web/global/design-tokens "Secondary text with more contrast"
		// @spec components/infrastructure/organizer/web/global/design-tokens "Regular contrast is unchanged"
		expectContrastLevel(root, consoleTokens, globals.moreContrast)
	},
} satisfies Story
