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

// The categories of collected data and the purposes the Privacy Policy states.
const PRIVACY_COLLECTED = {
	ja: {
		categories: [
			'アカウント情報',
			'ホームエリア',
			'フォロー中のアーティスト',
			'言語設定',
			'プッシュ通知の購読情報',
			'利用状況の分析データ',
			'購入に関する情報（注文、チケット、本人確認のための氏名・電話番号、決済の参照番号）',
			'購入の経路（紹介リンクに含まれる紹介コード）',
		],
		purposes: [
			'購入に関する情報を用いたチケットの発行、入場時の購入者の本人確認および返金の対応',
			'どの紹介リンクから購入されたかの計測、および紹介コードごとの購入数の公演の主催者への報告',
		],
		lastUpdated: '2026年10月16日',
	},
	en: {
		categories: [
			'Account information',
			'Home area',
			'Artists you follow',
			'Language preference',
			'Push notification subscription information',
			'Usage analytics data',
			'Purchase information (orders, tickets, the full name and phone number given for identity verification, and payment reference numbers)',
			'Purchase route (the referral code in the referral link you came from)',
		],
		purposes: [
			"Issuing tickets, checking the buyer's identity at entry, and handling refunds, using the purchase information",
			'Measuring which referral links led to purchases, and reporting the number of purchases per referral code to the organizer of the event',
		],
		lastUpdated: 'October 16, 2026',
	},
} as const

describe('Privacy Policy states the collected data and purposes', () => {
	for (const lng of ['ja', 'en'] as const) {
		it(`lists purchase records and the purchase route in ${lng}`, async () => {
			// @spec components/infrastructure/fan/web/global/legal-document "Collected data and purposes are stated"
			const fixture = await createFixture
				.html('<legal-document doc-key="privacy"></legal-document>')
				.deps(i18nFor(lng), LegalDocument)
				.build().started

			const text = fixture.appHost.textContent ?? ''
			const expected = PRIVACY_COLLECTED[lng]
			for (const category of expected.categories) {
				expect(text).toContain(category)
			}
			for (const purpose of expected.purposes) {
				expect(text).toContain(purpose)
			}
			expect(text).toContain(expected.lastUpdated)
		})
	}
})

// What the Privacy Policy says about recipients, the PostHog transfer and the
// fan's rights, per language.
const PRIVACY_DISCLOSURES = {
	ja: {
		recipients: [
			'PostHog（プロダクト分析）',
			'Resend（メール配信）',
			'Google（Firebase Cloud Messaging / Web Push によるプッシュ通知配信）',
			'Google（Gemini / Vertex AI によるライブ情報の検索）',
			'Last.fm（アーティスト情報の取得',
		],
		crossBorder: 'PostHog Cloud EU に移転します',
		posthog: [
			'Klant Solutions B.V.',
			'オランダ',
			'Cookie および localStorage を通じて取得される操作・利用イベント',
			'本サービスの改善および効果測定を目的とするプロダクト分析',
		],
		rights: [
			'「使い心地の改善に協力する」',
			'いつでも同意を撤回できます',
			'開示、訂正、追加、削除、利用停止等を請求することができます',
			'pannpers@pannpers.dev',
		],
	},
	en: {
		recipients: [
			'PostHog (product analytics)',
			'Resend (email delivery)',
			'Google (push notification delivery via Firebase Cloud Messaging / Web Push)',
			'Google (concert information search via Gemini / Vertex AI)',
			'Last.fm (retrieval of artist information',
		],
		crossBorder: 'transfers usage analytics data to PostHog Cloud EU',
		posthog: [
			'Klant Solutions B.V.',
			'the Netherlands',
			'interaction / usage events captured via cookies and localStorage',
			'product analytics: improving the Service and measuring its effectiveness',
		],
		rights: [
			'"Help improve the experience"',
			'withdraw your consent at any time',
			'disclose, correct, add to, delete, or suspend the use of your personal information',
			'pannpers@pannpers.dev',
		],
	},
} as const

async function privacyText(lng: 'ja' | 'en'): Promise<string> {
	const fixture = await createFixture
		.html('<legal-document doc-key="privacy"></legal-document>')
		.deps(i18nFor(lng), LegalDocument)
		.build().started
	return fixture.appHost.textContent ?? ''
}

describe('Privacy Policy discloses recipients, transfers and rights', () => {
	for (const lng of ['ja', 'en'] as const) {
		const expected = PRIVACY_DISCLOSURES[lng]

		it(`names the third-party recipients and the PostHog Cloud EU transfer in ${lng}`, async () => {
			// @spec components/infrastructure/fan/web/global/legal-document "Third-party transfer and cross-border processing are disclosed"
			const text = await privacyText(lng)
			for (const recipient of expected.recipients) {
				expect(text).toContain(recipient)
			}
			expect(text).toContain(expected.crossBorder)
		})

		it(`names PostHog with its country, data categories and purpose in ${lng}`, async () => {
			// @spec components/infrastructure/fan/web/global/legal-document "PostHog is named as a cross-border recipient with country, categories, and purpose"
			const text = await privacyText(lng)
			for (const part of expected.posthog) {
				expect(text).toContain(part)
			}
		})

		it(`explains consent withdrawal and the contact for requests in ${lng}`, async () => {
			// @spec components/infrastructure/fan/web/global/legal-document "Consent withdrawal and rights are explained"
			const text = await privacyText(lng)
			for (const part of expected.rights) {
				expect(text).toContain(part)
			}
		})
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
