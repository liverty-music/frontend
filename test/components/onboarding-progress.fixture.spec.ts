import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { describe, expect, it } from 'vitest'
import { OnboardingProgress } from '../../src/components/onboarding-progress/onboarding-progress'
import { SvgIcon } from '../../src/components/svg-icon/svg-icon'
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
			SvgIcon,
		)
		.build().started
	await tasksSettled()
	return fixture
}

describe('onboarding-progress', () => {
	// @spec components/infrastructure/fan/web/route/discovery "Screen reader"
	it('exposes the label and a progress value of 40 percent', async () => {
		const fixture = await render(0.4)
		const bar = fixture.appHost.querySelector('[role="progressbar"]')
		if (!bar) throw new Error('no progress bar')

		expect(bar.getAttribute('aria-valuemin')).toBe('0')
		expect(bar.getAttribute('aria-valuemax')).toBe('100')
		expect(bar.getAttribute('aria-valuenow')).toBe('40')
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

		// Seen: 「完成しました！」 and the timetable icon; heard: where it leads.
		expect(link?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'完成しました！ タイムテーブルを見る',
		)
		expect(link?.querySelector('.visually-hidden')?.textContent).toBe(
			'タイムテーブルを見る',
		)
		// The finished-timetable icon (a calendar with a check), not an arrow.
		expect(
			link
				?.querySelector('[aria-hidden="true"] svg-icon path')
				?.getAttribute('d'),
		).toBe('m9 16 2 2 4-4')
		expect(link?.getAttribute('href')).toBe('/dashboard')
		expect(fixture.appHost.querySelector('[role="progressbar"]')).toBeNull()
	})

	it('moves the band and flares the spark when the value rises', async () => {
		const fixture = await render(0.2)
		const bar = () =>
			fixture.appHost.querySelector<HTMLElement>('[role="progressbar"]')
		const rise = bar()?.dataset.rise
		fixture.component.value = 0.6
		await tasksSettled()

		expect(bar()?.getAttribute('aria-valuenow')).toBe('60')
		expect(bar()?.style.getPropertyValue('--progress')).toBe('60')
		// A new rise restarts the spark's flare.
		expect(bar()?.dataset.rise).not.toBe(rise)
	})
})
