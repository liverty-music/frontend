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
			'エラー情報（発生した不具合の内容、画面、その直前の操作）',
			'購入に関する情報（注文、チケット、本人確認のための氏名・電話番号、決済の参照番号）',
			'購入の経路（紹介リンクに含まれる紹介コード）',
		],
		purposes: [
			'不具合の検出と修正',
			'購入に関する情報を用いたチケットの発行、入場時の購入者の本人確認および返金の対応',
			'どの紹介リンクから購入されたかの計測、および紹介コードごとの購入数の公演の主催者への報告',
		],
		lastUpdated: '2026年10月27日',
	},
	en: {
		categories: [
			'Account information',
			'Home area',
			'Artists you follow',
			'Language preference',
			'Push notification subscription information',
			'Usage analytics data',
			'Error reports (what failed, on which screen, and the steps just before it)',
			'Purchase information (orders, tickets, the full name and phone number given for identity verification, and payment reference numbers)',
			'Purchase route (the referral code in the referral link you came from)',
		],
		purposes: [
			'Detecting and fixing defects',
			"Issuing tickets, checking the buyer's identity at entry, and handling refunds, using the purchase information",
			'Measuring which referral links led to purchases, and reporting the number of purchases per referral code to the organizer of the event',
		],
		lastUpdated: 'October 27, 2026',
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
			'PostHog（プロダクト分析およびエラー情報の収集）',
			'Resend（メール配信）',
			'Google（Firebase Cloud Messaging / Web Push によるプッシュ通知配信）',
			'Google（Gemini / Vertex AI によるライブ情報の検索）',
			'Last.fm（アーティスト情報の取得',
		],
		crossBorder:
			'利用状況の分析データおよびエラー情報を、オランダの Klant Solutions B.V. が運営する PostHog Cloud EU に移転します',
		posthog: [
			'Klant Solutions B.V.',
			'オランダ',
			'Cookie および localStorage を通じて取得される操作・利用イベント',
			'本サービスの改善および効果測定を目的とするプロダクト分析',
			'およびエラー情報（発生した不具合の内容、画面、その直前の操作）',
			'ならびに不具合の検出と修正',
		],
		rights: [
			'「使い心地の改善に協力する」',
			'いつでも同意を撤回できます',
			'「使い心地の改善に協力する」をオフにすると、エラー情報の送信も停止します。',
			'開示、訂正、追加、削除、利用停止等を請求することができます',
			'pannpers@pannpers.dev',
		],
	},
	en: {
		recipients: [
			'PostHog (product analytics and error reports)',
			'Resend (email delivery)',
			'Google (push notification delivery via Firebase Cloud Messaging / Web Push)',
			'Google (concert information search via Gemini / Vertex AI)',
			'Last.fm (retrieval of artist information',
		],
		crossBorder:
			'transfers usage analytics data and error reports to PostHog Cloud EU',
		posthog: [
			'Klant Solutions B.V.',
			'the Netherlands',
			'interaction / usage events captured via cookies and localStorage',
			'product analytics: improving the Service and measuring its effectiveness',
			'and error reports (what failed, on which screen, and the steps just before it)',
			'and detecting and fixing defects',
		],
		rights: [
			'"Help improve the experience"',
			'withdraw your consent at any time',
			'Turning off "Help improve the experience" also stops error reports.',
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

// What the Privacy Policy says about session recordings, per language.
const RECORDING_DISCLOSURES = {
	ja: [
		'画面操作の記録（セッションリプレイ）も上記の利用状況の分析データとともに PostHog に移転します',
		'画面上のすべての文字と入力内容を伏せ字にし',
		'購入手続き、抽選申込、本人確認および設定の各画面は記録しません',
		'記録の目的は本サービスの改善です',
		'設定画面の「セッションリプレイ」をオフにすると、記録は停止します',
	],
	en: [
		'recordings of your screens (session replay) are also transferred to PostHog',
		'all text on screen and every input value are masked',
		'the checkout, lottery entry, identity verification and Settings screens are never recorded',
		'Recordings are used to improve the Service',
		'Turning off Session replay in Settings stops recording',
	],
} as const

describe('Privacy Policy discloses session recordings', () => {
	for (const lng of ['ja', 'en'] as const) {
		it(`states masked recordings, unrecorded screens and how to stop in ${lng}`, async () => {
			// @spec components/infrastructure/fan/web/global/legal-document "Recording disclosed"
			const text = await privacyText(lng)
			for (const part of RECORDING_DISCLOSURES[lng]) {
				expect(text).toContain(part)
			}
		})
	}
})

// What the Privacy Policy says about deleting an account, per language.
const WITHDRAWAL_DISCLOSURES = {
	ja: [
		// How to delete.
		'設定画面の「アカウントを削除」から、いつでもアカウントを削除して退会できます',
		// What blocks it.
		'開催前の公演のチケット、出品中のリセール、抽選待ちの応募、または手続き中の購入があるときは、それらが終わるまで削除できません',
		// What is removed.
		'アカウント、ログイン情報（パスキーを含む）、フォロー中のアーティスト、通知の設定および本人確認の結果を削除します',
		// What is kept, for how many years and why.
		'注文およびチケットの取引記録は、会計、税務および紛争への対応のため、アカウントの削除後も7年間保管します',
		// What happens to analytics data.
		'すでに取得した利用状況の分析データは、利用者個人を識別できない状態で保持します',
	],
	en: [
		'You can delete your account and leave the Service at any time from "Delete account" in Settings',
		'While you have a ticket for an upcoming concert, a resale listing on sale, a lottery entry awaiting its draw or a purchase being paid, your account cannot be deleted until those are finished',
		'removes your account, your sign-in (including your passkeys), the artists you follow, your notification settings and your identity verification result',
		'Records of orders and tickets are kept for 7 years after your account is deleted, for accounting, tax and dispute handling',
		'Usage analytics data already collected is kept in a form that no longer identifies you',
	],
} as const

describe('Privacy Policy discloses what remains after withdrawal', () => {
	for (const lng of ['ja', 'en'] as const) {
		it(`states how to delete, the blockers, what is removed and kept, and analytics in ${lng}`, async () => {
			// @spec components/infrastructure/fan/web/global/legal-document "Withdrawal disclosed"
			const text = await privacyText(lng)
			for (const part of WITHDRAWAL_DISCLOSURES[lng]) {
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

// What the Terms of Service say about official resale, per language.
const TERMS_RESALE = {
	ja: [
		'第7条（公式リセール）',
		'完売した場合にのみ開始されます',
		'完売しなかった公演には公式リセールはなく',
		'入場開始時（開演の3時間前）に締め切られます',
		'10%のリセール手数料',
		'購入時に利用したカードへ返金されます',
	],
	en: [
		'7. Official Resale',
		'opens only when tickets sold first come, first served sell out',
		'A concert that does not sell out has no official resale',
		'Listing closes when admission to the concert opens, 3 hours before the start time',
		'a resale fee of 10%',
		'to the card you paid with',
	],
} as const

describe('Terms of Service state the official resale rules', () => {
	for (const lng of ['ja', 'en'] as const) {
		it(`has the official resale article in ${lng}`, async () => {
			// @spec components/infrastructure/fan/web/global/legal-document "Resale article present"
			const fixture = await createFixture
				.html('<legal-document doc-key="terms"></legal-document>')
				.deps(i18nFor(lng), LegalDocument)
				.build().started

			const text = fixture.appHost.textContent ?? ''
			for (const phrase of TERMS_RESALE[lng]) {
				expect(text).toContain(phrase)
			}
		})
	}
})
