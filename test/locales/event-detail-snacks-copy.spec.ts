import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'

/**
 * The event detail sheet's two inference snacks (a calendar add started
 * tracking; a journey raised the hype level) and their undo, in both locales.
 * Each message is two lines, split by a newline.
 */
const KEYS = ['trackingStarted', 'hypeRaised', 'undo', 'undoFailed'] as const

describe('event detail sheet snack copy', () => {
	it('has every key in both locales', () => {
		for (const key of KEYS) {
			expect(ja.eventDetail[key], `ja eventDetail.${key}`).toBeTruthy()
			expect(en.eventDetail[key], `en eventDetail.${key}`).toBeTruthy()
		}
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Calendar add from the sheet"
	it('reads the tracking snack as the spec words it', () => {
		expect(ja.eventDetail.trackingStarted.split('\n')).toEqual([
			'チケット状況を「追跡中」にしました。',
			'販売の情報をお知らせします。',
		])
		expect(en.eventDetail.trackingStarted.split('\n')).toEqual([
			'Ticket status set to Tracking.',
			'We will tell you about ticket sales.',
		])
		expect(ja.eventDetail.undo).toBe('取り消す')
		expect(en.eventDetail.undo).toBe('Undo')
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Applied for a distant concert raises the level"
	it('reads the raise snack as the spec words it, with the same placeholders', () => {
		expect(ja.eventDetail.hypeRaised.split('\n')).toEqual([
			'{{name}}を {{hype}} にしました。',
			'遠方の新着ライブも通知します。',
		])
		expect(en.eventDetail.hypeRaised.split('\n')).toEqual([
			'{{name}} is now {{hype}}.',
			'You will also hear about distant new concerts.',
		])
	})
})
