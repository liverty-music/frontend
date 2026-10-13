import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Runs `organizer/i18n/format.ts` in a Node process whose time zone is London,
 * the device of an operator abroad: a test worker cannot change its own time
 * zone once started. Returns what `body` evaluates to, through JSON.
 */
function inLondon<T>(body: string): T {
	const formatModule = fileURLToPath(
		new URL('../../../organizer/i18n/format.ts', import.meta.url),
	)
	const out = execFileSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`import * as f from ${JSON.stringify(formatModule)}; console.log(JSON.stringify(${body}))`,
		],
		{ env: { ...process.env, TZ: 'Europe/London' }, encoding: 'utf8' },
	)
	return JSON.parse(out) as T
}

describe('Japan time on a device abroad', () => {
	it('@spec components/infrastructure/organizer/web/global/i18n "Operator abroad"', () => {
		// An event starting at 18:00 in Tokyo on 2026-11-03 (09:00 UTC).
		const result = inLondon<{ deviceHour: number; ja: string; en: string }>(
			`(() => { const d = new Date('2026-11-03T09:00:00Z'); return { deviceHour: d.getHours(), ja: f.formatJstDateTime(d, 'ja'), en: f.formatJstDateTime(d, 'en') } })()`,
		)
		// The device clock reads 09:00; the console shows 18:00 JST.
		expect(result.deviceHour).toBe(9)
		expect(result.ja).toBe('11月3日(火) 18:00 JST')
		expect(result.en).toBe('Tue, Nov 3, 18:00 JST')
	})

	it('@spec components/infrastructure/organizer/web/global/i18n "Entering a sale window abroad"', () => {
		// The sale editors take a date field and a 24-hour time field (D19).
		const result = inLondon<{
			entered: string
			deviceLocal: string
			back: { date: string; time: string }
		}>(
			`(() => { const d = f.parseJstDateTime({ date: '2026-10-10', time: '12:00' }); return { entered: d.toISOString(), deviceLocal: new Date(2026, 9, 10, 12, 0).toISOString(), back: f.toJstDateTime(d) } })()`,
		)
		// 12:00 Japan time (03:00 UTC), not 12:00 London time (11:00 UTC).
		expect(result.entered).toBe('2026-10-10T03:00:00.000Z')
		expect(result.deviceLocal).toBe('2026-10-10T11:00:00.000Z')
		// The fields show the same wall clock back.
		expect(result.back).toEqual({ date: '2026-10-10', time: '12:00' })
	})
})

describe('a date and time entered separately', () => {
	it('names the part that is missing, the date first', async () => {
		const { unsetPartOf, sameJstDateTime } = await import(
			'../../../organizer/i18n/format'
		)
		expect(unsetPartOf({ date: '', time: '' })).toBe('date')
		expect(unsetPartOf({ date: '2026-02-30', time: '10:00' })).toBe('date')
		expect(unsetPartOf({ date: '2026-10-10', time: '' })).toBe('time')
		expect(unsetPartOf({ date: '2026-10-10', time: '24:00' })).toBe('time')
		expect(unsetPartOf({ date: '2026-10-10', time: '23:55' })).toBeNull()
		expect(
			sameJstDateTime(
				{ date: '2026-10-10', time: '12:00' },
				{ date: '2026-10-10', time: '12:00' },
			),
		).toBe(true)
		expect(
			sameJstDateTime(
				{ date: '2026-10-10', time: '12:00' },
				{ date: '2026-10-10', time: '12:05' },
			),
		).toBe(false)
	})
})
