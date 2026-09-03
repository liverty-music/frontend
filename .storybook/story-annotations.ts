import { I18nConfiguration } from '@aurelia/i18n'
import { BottomSheet } from '../src/components/bottom-sheet/bottom-sheet'
import { SvgIcon } from '../src/components/svg-icon/svg-icon'
import en from '../src/locales/en/translation.json'
import ja from '../src/locales/ja/translation.json'

// Shared project-level story annotations, used both by `.storybook/preview.ts`
// (Storybook dev UI) and `.storybook/vitest.setup.ts` (browser component tests).
// It must be a PLAIN object: parameters set inside `definePreview(...)` do not
// propagate to stories through `setProjectAnnotations`, whereas a plain trailing
// annotation object does — so the Vitest setup composes THIS object directly to
// guarantee a11y enforcement, i18n, and shared-component registration reach every
// story. i18next initializes synchronously here (inline `resources`, no async
// backend/detector), so `t`-bound templates resolve on first render.
export const sharedAnnotations = {
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
}
