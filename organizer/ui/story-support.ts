import '../styles/main.css'
import { I18nConfiguration } from '@aurelia/i18n'
import { type Locator, page } from 'vitest/browser'
import { ConsoleCatalogFormats } from '../i18n/console-language'
import { ConsoleFormatters } from '../i18n/converters'
import en from '../locales/en/translation.json'
import ja from '../locales/ja/translation.json'
import { ConsoleUi } from './index'
import { ConsoleShadowStyles } from './shadow-styles'

/**
 * Story parameters for console components: the console stylesheet (its own
 * tokens over the fan ones the preview loads), the console catalogs in
 * Japanese, the formatters and every console component.
 *
 * Imported by `organizer/**\/*.stories.ts` only; no app entry imports it.
 */
export const consoleStoryParameters = {
	aurelia: {
		register: [...ConsoleFormatters, ...ConsoleUi],
		configure: (au: { register: (...items: unknown[]) => unknown }) => {
			au.register(
				ConsoleShadowStyles,
				ConsoleCatalogFormats,
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
}

/**
 * Locators on a story's canvas that see into the shadow roots of console
 * components (design D16). Testing Library's `within` stops at a shadow root;
 * Vitest's browser locators use Playwright's selector engine, which pierces
 * open shadow roots. `.element()` returns the one match (like `getBy*`),
 * `.query()` the match or null (like `queryBy*`).
 */
export function canvasOf(canvasElement: HTMLElement): Locator {
	// A test id keeps the locator stable while the canvas's content changes.
	canvasElement.setAttribute('data-testid', CANVAS_TEST_ID)
	return page.getByTestId(CANVAS_TEST_ID)
}

const CANVAS_TEST_ID = 'story-canvas'

/** `querySelectorAll` that also looks inside open shadow roots. */
export function deepQueryAll<T extends Element = HTMLElement>(
	root: ParentNode,
	selector: string,
): T[] {
	const found = [...root.querySelectorAll<T>(selector)]
	if (root instanceof Element && root.shadowRoot) {
		found.push(...deepQueryAll<T>(root.shadowRoot, selector))
	}
	for (const el of root.querySelectorAll('*')) {
		if (el.shadowRoot) found.push(...deepQueryAll<T>(el.shadowRoot, selector))
	}
	return found
}

/** The first match of `selector`, inside open shadow roots too. */
export function deepQuery<T extends Element = HTMLElement>(
	root: ParentNode,
	selector: string,
): T {
	const el = deepQueryAll<T>(root, selector)[0]
	if (!el) throw new Error(`${selector} not rendered`)
	return el
}

/** The element that has focus, inside open shadow roots too. */
export function focusedElement(): Element | null {
	let active = document.activeElement
	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement
	}
	return active
}

/** A computed CSS color as 8-bit sRGB, read back from a canvas pixel. */
function srgbOf(color: string): [number, number, number] {
	const context = document.createElement('canvas').getContext('2d')
	if (!context) throw new Error('no 2d context')
	context.fillStyle = color
	context.fillRect(0, 0, 1, 1)
	const [r, g, b] = context.getImageData(0, 0, 1, 1).data
	return [r, g, b]
}

function luminance(color: string): number {
	const [r, g, b] = srgbOf(color).map((v) => {
		const c = v / 255
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two opaque CSS colors. */
export function contrastRatio(foreground: string, background: string): number {
	const [a, b] = [luminance(foreground), luminance(background)].sort(
		(x, y) => y - x,
	)
	return (a + 0.05) / (b + 0.05)
}

/** The computed color of a color role (`--md-color-…`) in the theme of `within`. */
export function roleColor(within: HTMLElement, role: string): string {
	const probe = document.createElement('span')
	probe.style.color = `var(${role})`
	within.append(probe)
	const color = getComputedStyle(probe).color
	probe.remove()
	return color
}
