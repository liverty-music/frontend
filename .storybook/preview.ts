// Load the app's global style layer (reset/tokens/global/composition/utility
// via the @layer chain in main.css) so stories render with the SAME M3 tokens
// and global utilities as the real app. Without this, only component-scoped CSS
// is present and the global M3 primitives (skeleton shimmer, press state layer,
// selection-morph, state layers) plus every `--md-*` token are undefined —
// making visual baselines unrepresentative. Imported first so the cascade layer
// order is established before any story styles.
import '../src/styles/main.css'
import { I18nConfiguration } from '@aurelia/i18n'
import { definePreview } from '@aurelia/storybook'
import addonA11y from '@storybook/addon-a11y'
import { BottomSheet } from '../src/components/bottom-sheet/bottom-sheet'
import { SvgIcon } from '../src/components/svg-icon/svg-icon'
import en from '../src/locales/en/translation.json'
import ja from '../src/locales/ja/translation.json'

// Project annotations for the Storybook UI and for the Vitest storybook
// projects alike: `@storybook/addon-vitest` applies this file (with the
// framework's and the addons' previews) to every story it runs, so nothing in
// a Vitest setup file may call `setProjectAnnotations` again. i18next
// initializes synchronously here (inline `resources`, no async
// backend/detector), so `t`-bound templates resolve on first render.
export default definePreview({
	addons: [addonA11y()],
	tags: ['autodocs'],
	parameters: {
		// Fail the run on any axe violation (design D3 / spec: "Accessibility checks
		// run on component stories").
		a11y: {
			test: 'error',
		},
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		// Aurelia app configuration applied to every story's mounted mini-app:
		// globally register the shared child custom elements used inside other
		// components' slots (svg-icon, bottom-sheet) and wire i18n so `t`-bound
		// templates (e.g. page-header) resolve translations.
		aurelia: {
			register: [SvgIcon, BottomSheet],
			configure: (au: { register: (...items: unknown[]) => unknown }) => {
				au.register(
					I18nConfiguration.customize((options) => {
						options.initOptions = {
							lng: 'ja',
							fallbackLng: 'ja',
							resources: {
								ja: { translation: ja },
								en: { translation: en },
							},
							interpolation: { escapeValue: false },
						}
					}),
				)
			},
		},
	},
})
