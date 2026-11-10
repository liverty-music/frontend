import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import {
	expectHover,
	expectKeyboardFocus,
	expectPress,
	expectRest,
	STATE_LAYER_SAMPLES,
} from '../../.storybook/state-layer'
import { consoleStoryParameters } from '../ui/story-support'
import sharedStyles from './shared.css?inline'

/**
 * The shared state layer (`shared/styles/state-layer.css`) in the organizer
 * console. The samples sit in a shadow root given `shared.css`, as every
 * console component is, so the layer is checked where console components use
 * it.
 */
const meta = {
	title: 'Console/Foundations/State Layer',
	parameters: consoleStoryParameters,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** A shadow root holding the samples, with the console's shared rules adopted. */
function consoleShadowRoot(canvasElement: HTMLElement): ShadowRoot {
	const host = document.createElement('div')
	host.dataset.testid = 'state-layer-host'
	canvasElement.append(host)
	const root = host.attachShadow({ mode: 'open' })
	const sheet = new CSSStyleSheet()
	sheet.replaceSync(sharedStyles)
	root.adoptedStyleSheets = [sheet]
	root.innerHTML = STATE_LAYER_SAMPLES
	return root
}

export const Rest = {
	render: () => defineAureliaStory({ template: '' }),
	play: async ({ canvasElement }) => {
		expectRest(consoleShadowRoot(canvasElement))
	},
} satisfies Story

export const Hovered = {
	render: () => defineAureliaStory({ template: '' }),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Pointer hover"
		await expectHover(consoleShadowRoot(canvasElement))
	},
} satisfies Story

export const KeyboardFocused = {
	render: () => defineAureliaStory({ template: '' }),
	play: async ({ canvasElement }) => {
		// The focus ring half of action-feedback "Keyboard focus" is checked on
		// the real button in console-button.stories.ts; this story checks the layer.
		await expectKeyboardFocus(consoleShadowRoot(canvasElement))
	},
} satisfies Story

export const Pressed = {
	render: () => defineAureliaStory({ template: '' }),
	play: async ({ canvasElement }) => {
		// The no-ring-after-click half of action-feedback "Pointer click" is
		// checked in console-button.stories.ts; this story checks the layer.
		await expectPress(
			consoleShadowRoot(canvasElement),
			'[data-testid="state-layer-host"] [data-sample="press"]',
		)
	},
} satisfies Story
