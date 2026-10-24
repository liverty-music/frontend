import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { describe, expect, it, vi } from 'vitest'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import consentTemplate from '../../src/routes/consent/consent-route.html?raw'
import welcomeCss from '../../src/routes/welcome/welcome-route.css?raw'
import welcomeTemplate from '../../src/routes/welcome/welcome-route.html?raw'

/** The local `<analytics-notice>` element, as the Welcome template declares it. */
function noticeElement(): string {
	const block = welcomeTemplate.match(
		/<template as-custom-element="analytics-notice">[\s\S]*?<\/template>/,
	)?.[0]
	if (!block) throw new Error('analytics-notice element not found')
	return block
}

/** A Get Started group of the Welcome template, by the element around it. */
function group(start: RegExp, end: string): string {
	const from = welcomeTemplate.search(start)
	if (from < 0) throw new Error(`${start} not found`)
	return welcomeTemplate.slice(
		from,
		welcomeTemplate.indexOf(end, from) + end.length,
	)
}

const HERO = () =>
	group(
		/<div class="\[ welcome-action-group welcome-hero-fallback-action-group \]">/,
		'</div>',
	)
const FOOTER = () =>
	group(/<footer class="\[ welcome-actions \]">/, '</footer>')

async function render(markup: string, lng: 'ja' | 'en' = 'ja') {
	const handleGetStarted = vi.fn(async () => {})
	const fixture = await createFixture
		.html(noticeElement() + markup)
		.component(
			class {
				public handleGetStarted = handleGetStarted
				public handleLogin = vi.fn(async () => {})
			},
		)
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng,
					fallbackLng: 'ja',
					resources: { ja: { translation: ja }, en: { translation: en } },
				}
			}),
			BusyOnClickCustomAttribute,
		)
		.build().started
	await tasksSettled()
	return { host: fixture.appHost, handleGetStarted }
}

/** The notice right after the Get Started button, or null. */
function noticeUnderGetStarted(host: HTMLElement): HTMLElement | null {
	const button = host.querySelector('[data-testid="welcome-get-started"]')
	const next = button?.nextElementSibling
	return next?.tagName === 'ANALYTICS-NOTICE' ? (next as HTMLElement) : null
}

const n = ja.welcome.analyticsNotice

describe('Welcome analytics notice', () => {
	// @spec components/infrastructure/fan/web/route/welcome "Notice under the demo footer button"
	it('sits directly under the Get Started button of the demo footer', async () => {
		const { host } = await render(FOOTER())
		const notice = noticeUnderGetStarted(host)

		expect(
			notice?.querySelector('.welcome-analytics-notice-text')?.textContent,
		).toBe(n.text)
		expect(
			notice
				?.querySelector('.welcome-analytics-notice-links')
				?.textContent?.replace(/\s+/g, ' ')
				.trim(),
		).toBe(`${n.lead}${n.optOut} ・ ${n.details}`)
	})

	// @spec components/infrastructure/fan/web/route/welcome "Notice under the hero button without a preview"
	// @spec stories/complete-onboarding "Visitor sees the notice on the first screen"
	it('sits directly under the hero Get Started button when there is no preview', async () => {
		const { host } = await render(HERO())

		const notice = noticeUnderGetStarted(host)
		expect(notice?.textContent).toContain(n.text)
		expect(notice?.querySelectorAll('a')).toHaveLength(2)
	})

	it('links the opt-out to Settings and the details to the details page', async () => {
		const { host } = await render(FOOTER())
		const notice = noticeUnderGetStarted(host)

		const optOut = notice?.querySelector(
			'[data-testid="welcome-analytics-opt-out"]',
		)
		const details = notice?.querySelector(
			'[data-testid="welcome-analytics-details"]',
		)
		expect(optOut?.textContent).toBe(n.optOut)
		expect(optOut?.getAttribute('href')).toBe('/settings?section=analytics')
		expect(details?.textContent).toBe(n.details)
		expect(details?.getAttribute('href')).toBe('/consent')
	})

	// @spec stories/complete-onboarding "Notice does not gate analytics or onboarding"
	it('needs no acknowledgement: Get Started works without opening a link', async () => {
		const { host, handleGetStarted } = await render(HERO())

		host
			.querySelector<HTMLButtonElement>('[data-testid="welcome-get-started"]')
			?.click()

		expect(handleGetStarted).toHaveBeenCalledTimes(1)
		expect(host.querySelector('analytics-notice button')).toBeNull()
	})

	it('names no analytics provider', () => {
		for (const locale of [ja, en]) {
			const text = Object.values(locale.welcome.analyticsNotice).join(' ')
			expect(text).not.toMatch(/PostHog|Klant/i)
		}
	})

	it('shows the English text in English', async () => {
		const { host } = await render(FOOTER(), 'en')

		expect(noticeUnderGetStarted(host)?.textContent).toContain(
			en.welcome.analyticsNotice.text,
		)
	})

	// @spec components/infrastructure/fan/web/route/welcome "Phrase-boundary wrapping on a narrow screen"
	it('breaks the notice only between phrases', () => {
		const rule = welcomeCss.match(
			/\.welcome-analytics-notice \{[\s\S]*?\n\t\t\}/,
		)?.[0]

		expect(rule).toMatch(/word-break: auto-phrase;/)
		expect(rule).toMatch(/text-wrap: balance;/)
	})
})

describe('analytics details page', () => {
	// @spec components/infrastructure/fan/web/route/welcome "Reading the details"
	it('names the recipient, the data sent and the purpose, and links the privacy policy', async () => {
		const fixture = await createFixture
			.html(consentTemplate.replace(/<import [^>]*><\/import>/g, ''))
			.component(
				class {
					public acknowledge = vi.fn()
					public openSettings = vi.fn()
					public openPrivacyPolicy = vi.fn()
				},
			)
			.deps(
				I18nConfiguration.customize((options) => {
					options.initOptions = {
						lng: 'ja',
						resources: { ja: { translation: ja } },
					}
				}),
				BusyOnClickCustomAttribute,
			)
			.build().started
		await tasksSettled()
		const text = fixture.appHost.textContent ?? ''

		// Recipient and the data sent.
		expect(text).toContain('Klant Solutions B.V.')
		expect(text).toContain('PostHog Cloud EU')
		// Purpose.
		expect(text).toContain(ja.onboarding.consent.intro)
		expect(
			[...fixture.appHost.querySelectorAll('button')].map((b) => b.textContent),
		).toContain(ja.settings.privacyPolicy)
	})
})
