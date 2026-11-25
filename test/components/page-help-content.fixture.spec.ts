import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import {
	PageHelp,
	type PageHelpPage,
} from '../../src/components/page-help/page-help'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { IAuthService } from '../../src/services/auth-service'
import { IGuideService } from '../../src/services/guide-service'
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

interface Options {
	signedIn?: boolean
	view?: 'artists' | 'concerts'
	hasArtists?: boolean
}

async function render(
	page: PageHelpPage,
	lng: 'ja' | 'en' = 'ja',
	opts: Options = {},
) {
	const guide = { replay: vi.fn() }
	const fixture = await createFixture
		.html(
			`<page-help page="${page}" view="${opts.view ?? 'artists'}" has-artists.bind="${opts.hasArtists ?? true}"></page-help>`,
		)
		.deps(
			Registration.instance(IAuthService, {
				isAuthenticated: opts.signedIn ?? true,
			}),
			Registration.instance(IGuideService, guide),
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
	const replays = [...host.querySelectorAll('.page-help-replay')].map(
		(b) => (b as HTMLElement).dataset.testid,
	)
	return { host, titles, text: host.textContent ?? '', replays, guide }
}

describe('page help content', () => {
	// @spec components/infrastructure/fan/web/global/page-help "Discovery help content"
	it('Discovery: finding artists, concerts and unfollowing', async () => {
		const { host, titles, text } = await render('discovery')
		const t = ja.pageHelp.discovery

		expect(titles).toEqual([
			t.findingSectionTitle,
			t.concertsSectionTitle,
			t.unfollowSectionTitle,
		])
		expect(t.concertsSectionTitle).toBe('ライブ')
		expect(text).toContain(t.concertsDesc)
		expect(text).toContain(t.description)
		expect(host.querySelector('.page-help-chip-demo')).not.toBeNull()
		expect(
			[...host.querySelectorAll('.page-help-tips li')].map(
				(li) => li.textContent,
			),
		).toEqual([t.genreTip, t.searchTip])
		expect(text).toContain(t.unfollowDesc)
		// On the bubbles each section with a moment ends with 「チュートリアル」.
		const { replays } = await render('discovery')
		expect(replays).toEqual(['help-replay-finding', 'help-replay-concerts'])
		expect(
			host.querySelector('[data-testid="help-replay-finding"]')?.textContent,
		).toBe('チュートリアル')
	})

	// @spec components/infrastructure/fan/web/global/page-help "Discovery help content"
	it('Discovery for a guest: no 「ライブ」 section', async () => {
		const { titles, replays } = await render('discovery', 'ja', {
			signedIn: false,
		})
		const t = ja.pageHelp.discovery
		expect(titles).toEqual([t.findingSectionTitle, t.unfollowSectionTitle])
		expect(replays).toEqual(['help-replay-finding'])
	})

	it('Discovery on the Concerts view: no replay of the bubble field moment', async () => {
		const { replays } = await render('discovery', 'ja', { view: 'concerts' })
		expect(replays).toEqual(['help-replay-concerts'])
	})

	// @spec components/infrastructure/fan/web/global/page-help "Timetable help content"
	it('Timetable: the stage lanes and concert details', async () => {
		const { host, titles, text } = await render('timetable')
		const t = ja.pageHelp.timetable

		expect(titles).toEqual([t.lanesSectionTitle, t.detailsSectionTitle])
		expect(
			[...host.querySelectorAll('.page-help-lanes dt')].map((dt) => [
				dt.textContent,
				[...dt.classList].find((c) => c.startsWith('stage-')),
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
	it('My Artists: hype, and Edit in the action menu at the bottom centre', async () => {
		const { titles, text } = await render('my-artists')

		expect(titles).toEqual(['Hype（熱量） について', 'フォロー解除'])
		expect(text).toContain('Hype（熱量）で通知の範囲が変わります。')
		expect(text).toContain(
			'遠征してでも見たいアーティストは Away に設定してみましょう！',
		)
		expect(text).toContain(
			'画面下中央のアクションメニューで「編集」を選ぶと、各行に削除ボタンが表示され、フォローを解除できます。',
		)
		expect(text).not.toMatch(/スライダー|ヘッダー|長押し|右下/)
	})

	it('My Artists: 「チュートリアル」 in the Hype section only with a followed artist', async () => {
		const withArtists = await render('my-artists')
		expect(withArtists.replays).toEqual(['help-replay-hype'])
		const without = await render('my-artists', 'ja', { hasArtists: false })
		expect(without.replays).toEqual([])
	})

	// @spec components/infrastructure/fan/web/route/my-artists "Help text available in all supported locales"
	it('My Artists in English', async () => {
		const { titles, text } = await render('my-artists', 'en')

		expect(titles).toEqual(['About Hype', 'Unfollowing'])
		expect(text).toContain('Hype controls how far away you get notified.')
		expect(text).toContain(
			'Choose Edit in the action menu at the bottom centre to show a remove button on each row and unfollow artists.',
		)
		expect(text).not.toMatch(/slider|header|long-press|bottom right/i)
	})

	// @spec components/infrastructure/fan/web/global/page-help "Tier content per row"
	// @spec components/infrastructure/fan/web/global/page-help "Semantic markup"
	// @spec components/infrastructure/fan/web/global/page-help "The flame count is read out"
	it('lists the four tiers in order; the eyes are hidden, the flames named with their count', async () => {
		for (const [lng, desc] of [
			[
				'ja',
				[
					'通知なし',
					'HOMEエリアのライブを通知',
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
			const icons = [...host.querySelectorAll('.help-hype-icon')]
			expect(icons[0].getAttribute('aria-hidden')).toBe('true')
			expect(
				icons
					.slice(1)
					.map((icon) => [
						icon.getAttribute('role'),
						icon.getAttribute('aria-label'),
					]),
			).toEqual(
				(lng === 'ja'
					? ['炎 1 つ', '炎 2 つ', '炎 3 つ']
					: ['1 flame', '2 flames', '3 flames']
				).map((name) => ['img', name]),
			)
			expect(host.textContent).not.toContain('全国')
		}
	})
})
