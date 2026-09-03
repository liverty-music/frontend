import * as a11yAddonAnnotations from '@storybook/addon-a11y/preview'
import { setProjectAnnotations } from '@aurelia/storybook/portable-stories'
import { beforeAll } from 'vitest'
import preview from './preview'
import { sharedAnnotations } from './story-annotations'

// Compose the project annotations for the Vitest `storybook` browser project:
//  1. `preview` — registers the Aurelia render function (without it, stories fail
//     with SB_PREVIEW_API_0014 "No render function available").
//  2. `@storybook/addon-a11y/preview` — the a11y `afterEach` that runs axe-core
//     and throws on violations during a standalone Vitest run.
//  3. `sharedAnnotations` (plain, trailing) — the a11y `test: 'error'` param, i18n
//     configuration, and shared-component registration. Parameters set INSIDE
//     `definePreview(...)` do not propagate to stories through
//     `setProjectAnnotations`, so they are re-asserted here as a plain last-wins
//     annotation to guarantee they reach every story.
const project = setProjectAnnotations([
	preview,
	a11yAddonAnnotations,
	sharedAnnotations,
])

beforeAll(project.beforeAll)
