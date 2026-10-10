import { describe, expect, it } from 'vitest'
import guide from '../../reception/public/guide.html?raw'
import routeTemplate from '../../reception/reception-route/reception-route.html?raw'
import verdictSource from '../../reception/reception-route/verdict.ts?raw'

/**
 * The reception guide (reception/public/guide.html) is a static page for venue
 * staff. It quotes the reception screen's words, so these checks fail when the
 * screen's copy changes and the guide is not updated with it.
 */
describe('reception guide', () => {
	it('is a static page with no script', () => {
		expect(guide).toMatch(/^<!doctype html>/i)
		expect(guide).not.toMatch(/<script/i)
		expect(guide).toContain('<html lang="ja">')
	})

	it('explains every refusal reason the screen can show', () => {
		const reasons = [...verdictSource.matchAll(/reason: '([^']+)'/g)]
			.map((m) => m[1])
			// The fallback for an unknown reason is not a case staff meet.
			.filter((r) => r !== '入場できません')
		expect(reasons.length).toBeGreaterThanOrEqual(6)
		for (const reason of reasons) {
			expect(guide, reason).toContain(reason)
		}
	})

	it('names the buttons and notices as the screen shows them', () => {
		for (const words of [
			'スキャンを開始',
			'スキャンを停止',
			'もう一度送信する',
			'もう一度確認する',
			'この受付リンクはもう使えません',
			'この受付リンクは別の端末で使用中です',
			'しばらく開けません',
			'受付時間が決まっていません',
			'判定中…',
		]) {
			expect(routeTemplate, words).toContain(words)
			expect(guide, words).toContain(words)
		}
	})
})
