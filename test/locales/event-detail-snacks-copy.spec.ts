import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'

/**
 * The event detail sheet's two inference snacks (a calendar add started
 * tracking; a journey raised the hype level) and their undo, in both locales.
 * The raise snack reads the words of the My Artists hype snack (`hypeReach.*`).
 */
const KEYS = ['trackingStarted', 'undo', 'undoFailed'] as const

describe('event detail sheet snack copy', () => {
	it('has every key in both locales', () => {
		for (const key of KEYS) {
			expect(ja.eventDetail[key], `ja eventDetail.${key}`).toBeTruthy()
			expect(en.eventDetail[key], `en eventDetail.${key}`).toBeTruthy()
		}
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Calendar add from the sheet"
	it('reads the tracking snack as the spec words it', () => {
		expect(ja.eventDetail.trackingStarted).toBe(
			'🔔 チケット販売の通知を受け取ります',
		)
		expect(en.eventDetail.trackingStarted).toBe(
			'🔔 You will get ticket sale notifications.',
		)
		expect(ja.eventDetail.undo).toBe('取り消す')
		expect(en.eventDetail.undo).toBe('Undo')
	})

	it('reads the raise snack with the hype snack words and the same placeholders', () => {
		expect(ja.hypeReach.on).toBe(
			'{{name}}の{{places}}の新着ライブをプッシュ通知します🔔',
		)
		expect(ja.hypeReach.off).toBe(
			'{{name}}の{{places}}の新着ライブをプッシュ通知で受け取ろう🔔',
		)
		for (const key of ['on', 'off'] as const) {
			expect(en.hypeReach[key]).toContain('{{name}}')
			expect(en.hypeReach[key]).toContain('{{places}}')
		}
	})
})
