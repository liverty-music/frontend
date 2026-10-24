import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it } from 'vitest'
import {
	PageHelp,
	type PageHelpPage,
} from '../../src/components/page-help/page-help'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { IOnboardingService } from '../../src/services/onboarding-service'

/** Pass-through sheet (jsdom has no Popover API); always shows its content. */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'ariaLabel'],
	},
	class {},
)
const SvgIconStub = CustomElement.define(
	{ name: 'svg-icon', template: '', bindables: ['name'] },
	class {},
)

async function render(page: PageHelpPage, lng: 'ja' | 'en' = 'ja') {
	const fixture = await createFixture
		.html(`<page-help page="${page}"></page-help>`)
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng,
					resources: { ja: { translation: ja }, en: { translation: en } },
				}
			}),
			Registration.instance(IOnboardingService, { isOnboarding: false }),
			BottomSheetStub,
			SvgIconStub,
			PageHelp,
		)
		.build().started
	await tasksSettled()
	const host = fixture.appHost
	const titles = [...host.querySelectorAll('.help-section-title')].map(
		(h) => h.textContent,
	)
	return { host, titles, text: host.textContent ?? '' }
}

describe('page help content', () => {
	// @spec components/infrastructure/fan/web/global/page-help "Discovery help content"
	it('Discovery: finding artists and unfollowing', async () => {
		const { host, titles, text } = await render('discovery')
		const t = ja.pageHelp.discovery

		expect(titles).toEqual([t.findingSectionTitle, t.unfollowSectionTitle])
		expect(text).toContain(t.description)
		expect(host.querySelector('.page-help-chip-demo')).not.toBeNull()
		expect(
			[...host.querySelectorAll('.page-help-tips li')].map(
				(li) => li.textContent,
			),
		).toEqual([t.genreTip, t.searchTip])
		expect(text).toContain(t.unfollowDesc)
	})

	// @spec components/infrastructure/fan/web/global/page-help "Dashboard help content"
	it('Dashboard: the stage lanes and concert details', async () => {
		const { host, titles, text } = await render('dashboard')
		const t = ja.pageHelp.dashboard

		expect(titles).toEqual([t.lanesSectionTitle, t.detailsSectionTitle])
		expect(
			[...host.querySelectorAll('.page-help-lanes dt')].map((dt) => [
				dt.textContent,
				dt.className,
			]),
		).toEqual([
			['HOME', 'stage-home'],
			['NEAR', 'stage-near'],
			['AWAY', 'stage-away'],
		])
		expect(text).toContain(t.cardTip)
	})

	// @spec components/infrastructure/fan/web/global/page-help "My Artists help content"
	// @spec components/infrastructure/fan/web/route/my-artists "Help text visible to touch device users"
	it('My Artists: hype with the dot selector, and Edit in the menu', async () => {
		const { titles, text } = await render('my-artists')

		expect(titles).toEqual(['Hype（熱量） について', 'フォロー解除'])
		expect(text).toContain(
			'Hype（熱量）で通知の範囲が変わります。各行の点をタップして切り替えます。',
		)
		expect(text).toContain(
			'遠征してでも見たいアーティストは Away に設定してみましょう！',
		)
		expect(text).toContain(
			'右下のメニューの「編集」をタップすると各行に削除ボタンが表示され、フォローを解除できます。',
		)
		expect(text).not.toMatch(/スライダー|ヘッダー|長押し/)
	})

	// @spec components/infrastructure/fan/web/route/my-artists "Help text available in all supported locales"
	it('My Artists in English', async () => {
		const { titles, text } = await render('my-artists', 'en')

		expect(titles).toEqual(['About Hype', 'Unfollowing'])
		expect(text).toContain(
			'Hype controls how far away you get notified. Tap a dot on the row to change it.',
		)
		expect(text).toContain(
			'Tap Edit in the menu at the bottom right to reveal per-row remove controls and unfollow artists.',
		)
		expect(text).not.toMatch(/slider|header|long-press/i)
	})

	// @spec components/infrastructure/fan/web/global/page-help "Tier content per row"
	// @spec components/infrastructure/fan/web/global/page-help "Semantic markup"
	it('lists the four tiers in order, icons hidden from assistive technology', async () => {
		for (const [lng, desc] of [
			[
				'ja',
				[
					'通知なし',
					'居住エリアのライブを通知',
					'近くのライブも通知',
					'全てのライブを通知',
				],
			],
			[
				'en',
				[
					'No notifications',
					'Notify for home-area concerts',
					'Notify for nearby concerts too',
					'Notify for every concert',
				],
			],
		] as const) {
			const { host } = await render('my-artists', lng)
			const rows = [...host.querySelectorAll('ul.help-hype-grid > li')]

			expect(
				rows.map((li) => [
					li.querySelector('.help-hype-icon')?.textContent,
					li.querySelector('.help-hype-label')?.textContent,
					li.querySelector('.help-hype-desc')?.textContent,
				]),
			).toEqual([
				['👀', 'Watch', desc[0]],
				['🔥', 'Home', desc[1]],
				['🔥🔥', 'Nearby', desc[2]],
				['🔥🔥🔥', 'Away', desc[3]],
			])
			for (const icon of host.querySelectorAll('.help-hype-icon')) {
				expect(icon.getAttribute('aria-hidden')).toBe('true')
			}
			expect(host.textContent).not.toContain('全国')
		}
	})
})
