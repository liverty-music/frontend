import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	ConsoleI18nConfiguration,
	IConsoleLanguage,
	LANGUAGE_STORAGE_KEY,
} from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import {
	formatJstDateTime,
	parseJstDateTimeLocal,
	toJstDateTimeLocal,
} from '../../../organizer/i18n/format'

function browserLanguages(languages: string[]): void {
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
	vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0])
}

async function mount(template: string, component: object = {}) {
	const fixture = createFixture(
		template,
		class {
			constructor() {
				Object.assign(this, component)
			}
		},
		[ConsoleI18nConfiguration, ...ConsoleFormatters],
	)
	await fixture.startPromise
	await tasksSettled()
	return fixture
}

describe('console language', () => {
	beforeEach(() => {
		localStorage.clear()
		document.documentElement.lang = ''
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('@spec components/infrastructure/organizer/web/global/i18n "First open on a Japanese browser"', async () => {
		browserLanguages(['ja-JP', 'ja'])
		const { assertText, tearDown } = await mount(`<p>\${'common.save' & t}</p>`)
		assertText('保存する')
		expect(document.documentElement.lang).toBe('ja')
		await tearDown()
	})

	it('@spec components/infrastructure/organizer/web/global/i18n "Browser in another language"', async () => {
		browserLanguages(['fr-FR', 'fr'])
		const { assertText, tearDown } = await mount(`<p>\${'common.save' & t}</p>`)
		assertText('Save')
		expect(document.documentElement.lang).toBe('en')
		await tearDown()
	})

	it('opens in English when the browser prefers English', async () => {
		browserLanguages(['en-US', 'en'])
		const { assertText, tearDown } = await mount(`<p>\${'common.save' & t}</p>`)
		assertText('Save')
		expect(document.documentElement.lang).toBe('en')
		await tearDown()
	})

	it('@spec components/infrastructure/organizer/web/global/i18n "Operator switches to English"', async () => {
		browserLanguages(['ja-JP'])
		const first = await mount(
			`<p>\${'common.save' & t}</p><p>\${price | yen}</p>`,
			{ price: 6500 },
		)
		first.assertText('保存する6,500円')

		await first.container.get(IConsoleLanguage).set('en')
		await tasksSettled()

		// Every text of the same mounted page changes at once: no reload.
		first.assertText('Save¥6,500')
		expect(document.documentElement.lang).toBe('en')
		expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
		await first.tearDown()

		// The next visit on this device opens in English.
		const next = await mount(`<p>\${'common.save' & t}</p>`)
		next.assertText('Save')
		await next.tearDown()
	})
})

describe('Japan time', () => {
	afterEach(() => vi.restoreAllMocks())

	it('formats a template date in Japan time', async () => {
		browserLanguages(['ja-JP'])
		localStorage.clear()
		const { assertText, tearDown } = await mount(
			`<p>\${startsAt | jstDateTime}</p>`,
			{ startsAt: new Date('2026-11-03T09:00:00Z') },
		)
		assertText('11月3日(火) 18:00 JST')
		await tearDown()
	})

	it('rejects a malformed or rolled-over value', () => {
		expect(parseJstDateTimeLocal('')).toBeUndefined()
		expect(parseJstDateTimeLocal('2026-02-30T10:00')).toBeUndefined()
		expect(parseJstDateTimeLocal('2026-10-10 12:00')).toBeUndefined()
		expect(formatJstDateTime(new Date('2026-11-03T09:00:00Z'), 'ja')).toBe(
			'11月3日(火) 18:00 JST',
		)
		expect(toJstDateTimeLocal(new Date('2026-10-10T03:00:00Z'))).toBe(
			'2026-10-10T12:00',
		)
	})
})

describe('yen and counts', () => {
	beforeEach(() => localStorage.clear())
	afterEach(() => vi.restoreAllMocks())

	it('@spec components/infrastructure/organizer/web/global/i18n "Ticket price"', async () => {
		browserLanguages(['ja-JP'])
		const { assertText, tearDown } = await mount(`<p>\${price | yen}</p>`, {
			price: 6500,
		})
		assertText('6,500円')
		await tearDown()
	})

	it('shows the English price with the yen sign', async () => {
		browserLanguages(['en-US'])
		const { assertText, tearDown } = await mount(`<p>\${price | yen}</p>`, {
			price: 6500,
		})
		assertText('¥6,500')
		await tearDown()
	})

	it('@spec components/infrastructure/organizer/web/global/i18n "Large count"', async () => {
		browserLanguages(['ja-JP'])
		const { assertText, tearDown } = await mount(
			`<p>\${requested | count}</p>`,
			{ requested: 1380 },
		)
		assertText('1,380')
		await tearDown()
	})
})
