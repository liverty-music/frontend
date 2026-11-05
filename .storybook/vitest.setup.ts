import { beforeEach } from 'vitest'
import { commands } from 'vitest/browser'

// `@storybook/addon-vitest` applies the project annotations (`preview.ts`, the
// framework's and the addons' previews) itself. Do not apply them again here.
// The addon also skips its own provisioning when a setup file in this
// directory merely contains the name of the portable-stories function that
// applies them, so keep that name out of this file, comments included.
// Storybook 11 rejects the call outright (SB_ADDON_VITEST_0002).

// Start every story with the pointer off its controls (see parkPointer). This
// is a Vitest browser command, which exists only while Vitest runs the story,
// so it stays here rather than in the preview's `beforeEach`.
beforeEach(() => commands.parkPointer())
