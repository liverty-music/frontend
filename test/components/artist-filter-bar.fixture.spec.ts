import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement } from 'aurelia'
import { describe, expect, it } from 'vitest'
import { ArtistFilterBar } from '../../src/components/artist-filter-bar/artist-filter-bar'
import ja from '../../src/locales/ja/translation.json'

/**
 * Renders the real filter-sheet template. The bottom sheet is a pass-through
 * stub (jsdom has no Popover API); its own open/dismiss behaviour is covered by
 * the bottom-sheet specs.
 */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'ariaLabelledby'],
	},
	class {},
)

describe('ArtistFilterBar (fixture)', () => {
	// @spec components/infrastructure/fan/web/route/dashboard "Empty upcoming timetable"
	it('keeps the "過去のコンサートも表示" affordance when the timetable has no concerts', async () => {
		// An empty today-onward timetable yields no artist chips at all.
		const fixture = await createFixture(
			'<artist-filter-bar counted-artists.bind="[]" component.ref="bar"></artist-filter-bar>',
			class Host {
				public bar!: ArtistFilterBar
			},
			[
				I18nConfiguration.customize((o) => {
					o.initOptions = { lng: 'ja', resources: { ja: { translation: ja } } }
				}),
				ArtistFilterBar,
				BottomSheetStub,
			],
		).started
		await tasksSettled()

		expect(fixture.appHost.querySelectorAll('.artist-chip')).toHaveLength(0)
		const toggle = fixture.appHost.querySelector(
			'button.date-facet-toggle',
		) as HTMLButtonElement
		expect(toggle).not.toBeNull()
		expect(toggle.textContent?.trim()).toBe('過去のコンサートも表示')

		// The fan can still look back: expanding reveals the date field.
		toggle.click()
		await tasksSettled()
		expect(
			fixture.appHost.querySelector('label[for="filter-from-input"]')
				?.textContent,
		).toBe('この日付以降を表示')
		expect(
			fixture.appHost.querySelector('input#filter-from-input[type="date"]'),
		).not.toBeNull()

		await fixture.stop(true)
	})
})
