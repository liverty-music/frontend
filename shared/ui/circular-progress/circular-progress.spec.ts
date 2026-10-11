import { createFixture } from '@aurelia/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { CircularProgress } from './circular-progress'

// The organizer console has no i18n yet, so the indicator must name itself
// without it.
describe('CircularProgress without i18n', () => {
	afterEach(() => {
		document.documentElement.lang = ''
	})

	async function nameOf(html: string): Promise<string | null | undefined> {
		const fixture = await createFixture
			.html(html)
			.deps(CircularProgress)
			.build().started
		const name = fixture.appHost
			.querySelector('[role="progressbar"]')
			?.getAttribute('aria-label')
		await fixture.stop(true)
		return name
	}

	it('names itself in the document language', async () => {
		document.documentElement.lang = 'en'
		expect(await nameOf('<circular-progress></circular-progress>')).toBe(
			'Loading',
		)
	})

	it('falls back to Japanese', async () => {
		document.documentElement.lang = 'fr'
		expect(await nameOf('<circular-progress></circular-progress>')).toBe(
			'読み込み中',
		)
	})

	it('uses the label the page sets', async () => {
		expect(
			await nameOf(
				'<circular-progress label="保存しています"></circular-progress>',
			),
		).toBe('保存しています')
	})

	it('carries no value while indeterminate', async () => {
		const fixture = await createFixture
			.html('<circular-progress></circular-progress>')
			.deps(CircularProgress)
			.build().started
		const bar = fixture.appHost.querySelector('[role="progressbar"]')
		expect(bar?.hasAttribute('aria-valuenow')).toBe(false)
		await fixture.stop(true)
	})
})
