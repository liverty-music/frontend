import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntryCodeSession } from '../../src/routes/tickets/entry-code-session'

/** A signer whose text names the tickets and the signed time. */
const signer = vi.fn(
	async (ids: readonly string[], signTime: number) =>
		`${ids.join(',')}@${signTime}`,
)

describe('EntryCodeSession', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-11-20T09:30:00.500Z'))
		signer.mockClear()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('signs at once and renews when the code turns 15 seconds old', async () => {
		const session = new EntryCodeSession(signer)
		await session.start(['a', 'b'])
		const t0 = Math.floor(Date.now() / 1000)
		expect(session.text).toBe(`a,b@${t0}`)

		// 15 s after the signed second (the code was made 0.5 s into it).
		await vi.advanceTimersByTimeAsync(14_499)
		expect(session.text).toBe(`a,b@${t0}`)
		await vi.advanceTimersByTimeAsync(1)
		expect(session.text).toBe(`a,b@${t0 + 15}`)
		session.stop()
	})

	it('never shows a code older than 15 seconds after the page was hidden', async () => {
		const session = new EntryCodeSession(signer)
		await session.start(['a'])
		const t0 = session.signTime

		// A hidden page's timers do not run: the clock moves, no timer fires.
		vi.setSystemTime(Date.now() + 60_000)
		const checked = session.check()
		// Withdrawn synchronously, before the new code is signed.
		expect(session.text).toBeNull()
		await checked
		expect(session.signTime).toBe(t0 + 60)
		expect(session.text).toBe(`a@${t0 + 60}`)
		session.stop()
	})

	it('remakes the code at once when the presented tickets change', async () => {
		const session = new EntryCodeSession(signer)
		await session.start(['a', 'b'])
		await session.setTickets(['a'])
		expect(session.text?.startsWith('a@')).toBe(true)
		await session.setTickets([])
		expect(session.text).toBeNull()
		expect(signer).toHaveBeenCalledTimes(2)
		session.stop()
	})

	it('retries when signing fails and shows nothing meanwhile', async () => {
		const failing = vi
			.fn<(ids: readonly string[], t: number) => Promise<string>>()
			.mockRejectedValueOnce(new Error('no key'))
			.mockResolvedValue('ok')
		const session = new EntryCodeSession(failing)
		await session.start(['a'])
		expect(session.failed).toBe(true)
		expect(session.text).toBeNull()
		await vi.advanceTimersByTimeAsync(1000)
		expect(session.failed).toBe(false)
		expect(session.text).toBe('ok')
		session.stop()
	})

	it('drops a signature that arrives after stop', async () => {
		let release: (text: string) => void = () => {}
		const slow = vi.fn(
			() =>
				new Promise<string>((r) => {
					release = r
				}),
		)
		const session = new EntryCodeSession(slow)
		const started = session.start(['a'])
		session.stop()
		release('late')
		await started
		expect(session.text).toBeNull()
	})
})
