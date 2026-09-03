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
