// Load the app's global style layer (reset/tokens/global/composition/utility
// via the @layer chain in main.css) so stories render with the SAME M3 tokens
// and global utilities as the real app. Without this, only component-scoped CSS
// is present and the global M3 primitives (skeleton shimmer, press-feedback,
// selection-morph, state layers) plus every `--md-*` token are undefined —
// making visual baselines unrepresentative. Imported first so the cascade layer
// order is established before any story styles.
import '../src/styles/main.css'
import { definePreview } from '@aurelia/storybook'
import addonA11y from '@storybook/addon-a11y'
import { sharedAnnotations } from './story-annotations'

// Storybook dev-UI preview. The shared project annotations (a11y config, i18n,
// shared-component registration, autodocs tags, control matchers) live in
// `story-annotations.ts` so the Vitest browser project can compose the exact
// same config (see `.storybook/vitest.setup.ts`).
export default definePreview({
	addons: [addonA11y()],
	...sharedAnnotations,
})
