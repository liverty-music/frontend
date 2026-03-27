import { I18N } from '@aurelia/i18n'
import { createFixture } from '@aurelia/testing'
import { Registration } from 'aurelia'
import { describe, it } from 'vitest'
import { DateValueConverter } from '../../src/value-converters/date'
import { createMockI18n } from '../helpers/mock-i18n'

/**
 * createFixture integration test for DateValueConverter.
 * Verifies the converter works within an Aurelia template pipeline
 * (per Aurelia 2 testing-value-converters docs).
 */

describe('DateValueConverter (fixture)', () => {
	it('renders formatted date in template via | date pipe', async () => {
		const fixture = await createFixture
			.component(
				class App {
					eventDate = '2026-03-15'
				},
			)
			// biome-ignore lint/suspicious/noTemplateCurlyInString: Aurelia template syntax
			.html('<span>${eventDate | date}</span>')
			.deps(DateValueConverter, Registration.instance(I18N, createMockI18n()))
			.build().started

		// Mock i18n returns 'ja' locale; short format = month/day
		fixture.assertText('span', '3/15')
	})
})
