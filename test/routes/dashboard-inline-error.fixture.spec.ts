import { I18N, I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Code, ConnectError } from '@connectrpc/connect'
import { resolve } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { InlineError } from '../../src/components/inline-error/inline-error'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import dashboardTemplate from '../../src/routes/dashboard/dashboard-route.html?raw'

/**
 * The dashboard's own error block for the timetable, taken from its template
 * so the binding under test is the one that ships. The rest of the dashboard
 * (highway, sheets, prompts) is not needed to show the error.
 */
function timetableErrorBlock(): string {
	const block = dashboardTemplate.match(
		/<inline-error\s[^>]*if\.bind="loadError"[\s\S]*?<\/inline-error>/,
	)?.[0]
	if (!block) throw new Error('dashboard timetable inline-error not found')
	return block
}

async function render(loadError: unknown, lng: 'ja' | 'en' = 'ja') {
	const loadData = vi.fn()
	const fixture = await createFixture
		.html(timetableErrorBlock())
		.component(
			class {
				public readonly i18n = resolve(I18N)
				public loadError = loadError
				public loadData = loadData
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
			InlineError,
		)
		.build().started
	await tasksSettled()
	return { fixture, loadData }
}

describe('dashboard timetable inline error', () => {
	// @spec components/infrastructure/fan/web/global/error-messages "Timetable fails to load"
	it('shows the catalog message and a retry button, never the server message', async () => {
		const { fixture, loadData } = await render(
			new ConnectError(
				'upstream connect error or disconnect/reset before headers',
				Code.Unavailable,
			),
		)
		const host = fixture.appHost

		expect(host.querySelector('.inline-error-message')?.textContent).toBe(
			'ライブの読み込みに失敗しました',
		)
		const retry = host.querySelector('button')
		expect(retry?.textContent).toBe('再試行')
		expect(host.textContent).not.toContain('upstream connect error')
		expect(host.textContent).not.toContain('unavailable')

		retry?.click()
		expect(loadData).toHaveBeenCalledOnce()
		await fixture.stop(true)
	})

	it('labels the retry button in English for a fan using English', async () => {
		const { fixture } = await render(new Error('boom'), 'en')

		expect(
			fixture.appHost.querySelector('.inline-error-message')?.textContent,
		).toBe('Failed to load live events')
		expect(fixture.appHost.querySelector('button')?.textContent).toBe('Retry')
		expect(fixture.appHost.textContent).not.toContain('boom')
		await fixture.stop(true)
	})
})
