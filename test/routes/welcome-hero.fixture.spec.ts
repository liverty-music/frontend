import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { describe, expect, it } from 'vitest'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { WelcomeHero } from '../../src/routes/welcome/welcome-hero'

async function renderHero(lng: 'ja' | 'en') {
	const fixture = await createFixture
		.html('<welcome-hero has-preview.bind="true"></welcome-hero>')
		.component(class {})
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng,
					fallbackLng: 'ja',
					resources: { ja: { translation: ja }, en: { translation: en } },
				}
			}),
			WelcomeHero,
			BusyOnClickCustomAttribute,
		)
		.build().started
	await tasksSettled()
	return fixture
}

describe('welcome hero scroll affordance', () => {
	// @spec components/infrastructure/fan/web/route/welcome "Button label is localized"
	it('labels the button in Japanese in a Japanese page and in English in an English page', async () => {
		const japanese = await renderHero('ja')
		const jaLabel = japanese.appHost.querySelector(
			'[data-testid="welcome-see-preview"] span',
		)?.textContent
		expect(jaLabel).toBe('サンプルを覗く')
		expect(jaLabel).toBe(ja.welcome.hero.seePreview)
		await japanese.stop(true)

		const english = await renderHero('en')
		const enLabel = english.appHost.querySelector(
			'[data-testid="welcome-see-preview"] span',
		)?.textContent
		expect(enLabel).toBe('Peek at a sample')
		expect(enLabel).toBe(en.welcome.hero.seePreview)
		await english.stop(true)
	})
})
