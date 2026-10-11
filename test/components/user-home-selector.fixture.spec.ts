import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserHomeSelector } from '../../src/components/user-home-selector/user-home-selector'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import en from '../../src/locales/en/translation.json'

/**
 * The home area selector rendered from its real template with the real
 * English bundle. The bottom sheet is a pass-through stub (jsdom has no
 * Popover API); its own behaviour is covered by the bottom-sheet specs.
 */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'dismissable', 'ariaLabel'],
	},
	class {},
)

async function render(currentCode: string | null = null) {
	const onHomeSelected = vi.fn()
	const fixture = await createFixture(
		'<user-home-selector component.ref="selector" current-code.bind="currentCode" on-home-selected.bind="onHomeSelected"></user-home-selector>',
		class Host {
			public selector!: UserHomeSelector
			public currentCode = currentCode
			public onHomeSelected = onHomeSelected
		},
		[
			I18nConfiguration.customize((o) => {
				o.initOptions = { lng: 'en', resources: { en: { translation: en } } }
			}),
			UserHomeSelector,
			BottomSheetStub,
			BusyOnClickCustomAttribute,
		],
	).started
	fixture.component.selector.open()
	await tasksSettled()
	const host = fixture.appHost
	const buttons = () =>
		[...host.querySelectorAll<HTMLButtonElement>('.selector-btn')].map((b) => ({
			el: b,
			label: b.textContent?.trim() ?? '',
		}))
	const button = (label: string) =>
		buttons().find((b) => b.label === label)?.el ?? null
	return { fixture, host, onHomeSelected, buttons, button }
}

describe('UserHomeSelector (fixture)', () => {
	afterEach(() => {
		localStorage.clear()
	})

	// @spec components/infrastructure/fan/web/global/user-home-selector "Step 1 displays quick-select cities and regions"
	it('opens on step 1 with the quick-select cities and the regions', async () => {
		const { fixture, buttons } = await render()

		expect(buttons().map((b) => b.label)).toEqual([
			'Tokyo',
			'Osaka',
			'Nagoya',
			'Fukuoka',
			'Sapporo',
			'Sendai',
			'Hokkaido',
			'Tohoku',
			'Kanto',
			'Chubu',
			'Kinki',
			'Chugoku',
			'Shikoku',
			'Kyushu',
		])
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/user-home-selector "Quick-select city confirms immediately"
	it('confirms a quick-select city with its code, without step 2', async () => {
		const { fixture, host, onHomeSelected, button } = await render()

		button('Tokyo')?.click()
		await tasksSettled()

		expect(onHomeSelected).toHaveBeenCalledExactlyOnceWith('JP-13')
		expect(fixture.component.selector.selectedRegion).toBeNull()
		expect(host.querySelector('.selector-back-btn')).toBeNull()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/user-home-selector "Region tap transitions to Step 2"
	it('shows the region prefectures and a labelled back control on a region tap', async () => {
		const { fixture, host, onHomeSelected, buttons, button } = await render()

		button('Kanto')?.click()
		await tasksSettled()

		const labels = buttons().map((b) => b.label)
		expect(labels).toContain('Tokyo')
		expect(labels).toContain('Kanagawa')
		expect(labels).not.toContain('Osaka')
		expect(onHomeSelected).not.toHaveBeenCalled()

		const back = host.querySelector<HTMLButtonElement>('.selector-back-btn')
		expect(back?.querySelector('svg')).not.toBeNull()
		// The visible label is the localized key's text and is the only name.
		expect(back?.textContent?.trim()).toBe(en.userHome.backToRegions)
		expect(back?.hasAttribute('aria-label')).toBe(false)

		back?.click()
		await tasksSettled()
		expect(button('Kanto')).not.toBeNull()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/user-home-selector "Prefecture selection in Step 2 confirms"
	it('confirms a step-2 prefecture with its code', async () => {
		const { fixture, onHomeSelected, button } = await render()

		button('Kinki')?.click()
		await tasksSettled()
		button('Osaka')?.click()
		await tasksSettled()

		expect(onHomeSelected).toHaveBeenCalledExactlyOnceWith('JP-27')
		// The component itself persists nothing.
		expect(localStorage.getItem('guest.home')).toBeNull()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/user-home-selector "Current selection highlight via bindable prop"
	it('highlights the option matching currentCode, and none without it', async () => {
		const highlighted = (r: Awaited<ReturnType<typeof render>>) =>
			r
				.buttons()
				.filter((b) => b.el.getAttribute('aria-current') === 'true')
				.map((b) => b.label)

		const withCode = await render('JP-27')
		expect(highlighted(withCode)).toEqual(['Osaka'])
		withCode.button('Kinki')?.click()
		await tasksSettled()
		expect(highlighted(withCode)).toEqual(['Osaka'])
		await withCode.fixture.stop(true)

		const withoutCode = await render(null)
		expect(highlighted(withoutCode)).toEqual([])
		await withoutCode.fixture.stop(true)
	})
})
