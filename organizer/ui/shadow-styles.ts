import { StyleConfiguration } from 'aurelia'
import sharedStyles from '../styles/shared.css?inline'

/**
 * Gives the console's shared rules (reset, focus ring, state layer, touch
 * target, visually hidden) to the shadow root of every console component
 * (design D16). Each component renders in its own shadow root, so no page
 * style reaches inside it; the tokens are custom properties and inherit
 * through the shadow boundary unchanged.
 *
 * Registered by the console entry and by the console stories, so a story
 * renders a component the way a screen does.
 */
export const ConsoleShadowStyles = StyleConfiguration.shadowDOM({
	sharedStyles: [sharedStyles],
})
