import { I18nConfiguration } from '@aurelia/i18n'
import { createFixture } from '@aurelia/testing'
import { describe, expect, it } from 'vitest'
import { LegalDocument } from '../../src/components/legal-document/legal-document'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { LicensesRoute } from '../../src/routes/legal/licenses-route'

/**
 * Smoke test for the public `/legal/*` documents. Mounts each document with the
 * REAL i18n resource bundles (not a mock) so it verifies that every document
 * actually renders its hand-authored content in both Japanese and English — the
 * acceptance criterion for the add-legal-documents change (task 5.3 / the
 * "Legal documents are localized" requirement).
 *
 * `lng` is pinned per fixture (no language detector) so each case renders a
 * single, deterministic locale.
 */
function i18nFor(lng: 'ja' | 'en') {
	return I18nConfiguration.customize((options) => {
		options.initOptions = {
			lng,
			resources: { ja: { translation: ja }, en: { translation: en } },
			fallbackLng: 'ja',
			supportedLngs: ['ja', 'en'],
			interpolation: { escapeValue: false },
		}
	})
}

// Localized title each document must surface, used as the render assertion.
const EXPECTED = {
	terms: { ja: '利用規約', en: 'Terms of Service' },
	privacy: { ja: 'プライバシーポリシー', en: 'Privacy Policy' },
} as const

describe('legal documents render in ja and en', () => {
	for (const docKey of ['terms', 'privacy'] as const) {
		for (const lng of ['ja', 'en'] as const) {
			it(`renders the ${docKey} document in ${lng}`, async () => {
				const fixture = await createFixture
					.html(`<legal-document doc-key="${docKey}"></legal-document>`)
					.deps(i18nFor(lng), LegalDocument)
					.build().started

				const text = fixture.appHost.textContent ?? ''
				// Title is present (the document rendered in this locale)...
				expect(text).toContain(EXPECTED[docKey][lng])
				// ...and the signal-reactive sections array rendered at least
				// one section heading rather than collapsing to an empty list.
				expect(
					fixture.appHost.querySelectorAll('.legal-section').length,
				).toBeGreaterThan(0)
			})
		}
	}
})

describe('OSS licenses page renders in ja and en', () => {
	for (const lng of ['ja', 'en'] as const) {
		it(`renders the generated package list in ${lng}`, async () => {
			const fixture = await createFixture
				.html('<licenses-route></licenses-route>')
				.deps(i18nFor(lng), LicensesRoute)
				.build().started

			const text = fixture.appHost.textContent ?? ''
			expect(text).toContain(lng === 'ja' ? 'OSSライセンス' : 'OSS Licenses')
			// The build-time generated artifact yielded a non-empty list.
			expect(
				fixture.appHost.querySelectorAll('.licenses-item').length,
			).toBeGreaterThan(0)
		})
	}
})
