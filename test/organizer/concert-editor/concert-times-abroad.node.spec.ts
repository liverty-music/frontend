import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Runs the Japan-time functions the concert editor's times go through
 * (`composeInstant` reads a date and `HH:mm` with `parseJstDateAndTime`;
 * reopening shows them with `toJstDateInput` and `toJstTimeInput`) in a Node process whose time zone is
 * London, the device of a member abroad: a test worker cannot change its own
 * time zone once started. Returns what `body` evaluates to, through JSON.
 */
function inLondon<T>(body: string): T {
	const format = JSON.stringify(
		fileURLToPath(
			new URL('../../../organizer/i18n/format.ts', import.meta.url),
		),
	)
	const out = execFileSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`import * as f from ${format}; console.log(JSON.stringify(${body}))`,
		],
		{ env: { ...process.env, TZ: 'Europe/London' }, encoding: 'utf8' },
	)
	return JSON.parse(out) as T
}

describe('the concert editor on a device abroad', () => {
	it('@spec components/infrastructure/organizer/web/route/concert-editor "Device in another time zone"', () => {
		const result = inLondon<{
			deviceHour: number
			sent: string
			time: string
			date: string
		}>(
			`(() => {
				const sent = f.parseJstDateAndTime('2026-12-20', '18:00')
				return {
					deviceHour: new Date('2026-12-20T09:00:00Z').getHours(),
					sent: sent.toISOString(),
					time: f.toJstTimeInput(sent),
					date: f.toJstDateInput(sent),
				}
			})()`,
		)
		// The device's clock reads 09:00 for the instant that is 18:00 in Japan.
		expect(result.deviceHour).toBe(9)
		// 18:00 JST on 20 December is 09:00 UTC, whatever the device's zone.
		expect(result.sent).toBe('2026-12-20T09:00:00.000Z')
		// Reopening the editor reads the stored instant back as 18:00.
		expect(result.time).toBe('18:00')
		expect(result.date).toBe('2026-12-20')
	})
})
