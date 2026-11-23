import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'

/** Every string value of a catalog, with its dotted key. */
function strings(node: unknown, prefix = ''): [string, string][] {
	if (typeof node === 'string') return [[prefix, node]]
	if (Array.isArray(node)) {
		return node.flatMap((v, i) => strings(v, `${prefix}[${i}]`))
	}
	if (typeof node === 'object' && node !== null) {
		return Object.entries(node).flatMap(([k, v]) =>
			strings(v, prefix ? `${prefix}.${k}` : k),
		)
	}
	return []
}

describe('guide moments copy', () => {
	it('words each guide line and the replay button as the owner chose', () => {
		expect(ja.guide).toEqual({
			discoveryFollow: '気になるアーティストをタップしてフォローしよう！',
			discoverySwap: 'すぐに行けるライブも見てみよう！',
			concertsFilter: '遠征するときはココを変更！',
			sheetNotify: '気になるライブは見逃しNG！',
			// The gloss takes the app's one form, Hype（熱量） (i18n "Japanese
			// gloss is prose").
			myArtistsHype: 'Hype（熱量）に合わせて 🔥 を変えてみよう！',
			replay: 'チュートリアル',
		})
		expect(Object.keys(en.guide)).toEqual(Object.keys(ja.guide))
		expect(en.guide.replay).toBe('Show me')
	})

	it('words the guest sign-up dialog of the notification button', () => {
		expect(ja.concertSheet.signUpDialog).toEqual({
			title: 'おっと、まだアカウントを持っていないね？',
			body: '通知に必要なアカウントは無料ですぐに作成できるよ！',
			later: 'あとで',
			signUp: 'Sign Up',
		})
		expect(en.concertSheet.signUpDialog.signUp).toBe('Sign Up')
		expect(en.concertSheet.signUpDialog.later).toBe('Later')
	})

	it('has no guest push line in the ticket section', () => {
		expect(ja.concertSheet.pushLine).not.toHaveProperty('guest')
		expect(en.concertSheet.pushLine).not.toHaveProperty('guest')
	})

	it('labels a sign-up action 「Sign Up」 in both locales', () => {
		expect(ja.hypeReach.signUp).toBe('Sign Up')
		expect(en.hypeReach.signUp).toBe('Sign Up')
	})

	it('labels the Concerts view filter item and keeps the Timetable one', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Filter item opens the filter sheet"
		expect(ja.actionMenu.concertsFilter).toBe('エリアと期間を変える')
		expect(en.actionMenu.concertsFilter).toBe('Change area and dates')
		expect(ja.actionMenu.filter).toBe('コンサート一覧の絞り込み')
	})

	it('labels the follow action 「Follow」 / 「Following」 in both locales', () => {
		for (const catalog of [ja, en]) {
			expect(catalog.discoveryConcerts.follow).toEqual({
				action: 'Follow',
				following: 'Following',
			})
		}
	})

	it("words the post-signup celebration's second line on two lines", () => {
		// @spec components/infrastructure/fan/web/global/celebration-overlay "Post-signup full celebration then dialog"
		expect(ja.timetable.celebration.chasing.split('\n')).toEqual([
			'新着ライブは',
			'Liverty Music にお任せ！',
		])
		expect(en.timetable.celebration.chasing.split('\n')).toHaveLength(2)
	})

	it('lets the light celebration headline break between its two phrases', () => {
		// 「タイムテーブル完成！」 is one phrase to the browser, so on a phone
		// narrower than the headline it needs a marked place to break (U+200B).
		expect(ja.timetable.celebration.complete).toBe('タイムテーブル\u200b完成！')
		expect(ja.timetable.celebration.complete.replace('\u200b', '')).toBe(
			'タイムテーブル完成！',
		)
	})

	it('titles the notification step after a sign-up from the notification button', () => {
		expect(ja.postSignup.notify.titleTrack).toBe(
			'あとはプッシュ通知をオンにするだけ！',
		)
		expect(en.postSignup.notify.titleTrack).toBe(
			'Just turn on push notifications!',
		)
	})
})

describe('home area naming', () => {
	it('asks where the person lives in the friend voice', () => {
		// @spec components/infrastructure/fan/web/global/home-area-selector "Description copy explains what the HOME lane displays and asks for residence"
		expect(ja.homeAreaSelector.title).toBe('HOMEエリアを選択')
		expect(ja.homeAreaSelector.description).toBe(
			'住んでるエリアを教えてね！近くのライブを HOME に並べるよ',
		)
	})

	it('calls the home area HOMEエリア everywhere in Japanese', () => {
		// @spec components/infrastructure/fan/web/global/home-area-selector "One name for the home area"
		const offending = strings(ja).filter(
			([, v]) => v.includes('ホームエリア') || v.includes('居住エリア'),
		)
		expect(offending).toEqual([])
		expect(ja.entity.homeArea.label).toBe('HOMEエリア')
		expect(ja.settings.myHomeArea).toBe('HOMEエリア')
		expect(ja.hypeReach.noHome).toBe('HOMEエリア')
		expect(ja.homeAreaSelector.saveFailed).toContain('HOMEエリア')
		expect(ja.pageHelp.myArtists.homeDesc).toBe('HOMEエリアのライブを通知')
	})
})
