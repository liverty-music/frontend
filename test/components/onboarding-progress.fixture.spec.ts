import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { describe, expect, it } from 'vitest'
import { OnboardingProgress } from '../../src/components/onboarding-progress/onboarding-progress'
import ja from '../../src/locales/ja/translation.json'

async function render(value: number) {
	const fixture = await createFixture
		.html('<onboarding-progress value.bind="value"></onboarding-progress>')
		.component(
			class {
				public value = value
			},
		)
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: 'ja',
					resources: { ja: { translation: ja } },
				}
			}),
			OnboardingProgress,
		)
		.build().started
	await tasksSettled()
	return fixture
}

describe('onboarding-progress', () => {
	// @spec components/infrastructure/fan/web/route/discovery "Screen reader"
	it('exposes the label and a progress value of 40 percent', async () => {
		const fixture = await render(0.4)
		const bar = fixture.appHost.querySelector('progress')
		if (!bar) throw new Error('no progress bar')

		expect(bar.max).toBe(100)
		expect(bar.value).toBe(40)
		const label = fixture.appHost.querySelector(
			`#${bar.getAttribute('aria-labelledby')}`,
		)
		expect(label?.textContent).toBe('タイムテーブル完成まで')
		expect(fixture.appHost.querySelector('a')).toBeNull()
	})

	// @spec components/infrastructure/fan/web/route/discovery "Button opens the Dashboard"
	it('becomes the link to the Dashboard when ready', async () => {
		const fixture = await render(1)
		const link = fixture.appHost.querySelector('a')

		expect(link?.textContent).toBe('タイムテーブルができました →')
		expect(link?.getAttribute('href')).toBe('/dashboard')
		expect(fixture.appHost.querySelector('progress')).toBeNull()
	})

	it('updates the bar when the value moves', async () => {
		const fixture = await render(0.2)
		fixture.component.value = 0.6
		await tasksSettled()

		expect(fixture.appHost.querySelector('progress')?.value).toBe(60)
	})
})
