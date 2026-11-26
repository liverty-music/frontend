import { describe, expect, it } from 'vitest'
import {
	restoreSnapshot,
	type WalletSnapshot,
} from '../../src/routes/tickets/ticket-view'

describe('restoreSnapshot', () => {
	it('keeps the date of a list saved with instants and drops its times', () => {
		const saved = {
			saveTime: new Date('2026-11-01T00:00:00Z'),
			groups: [
				{
					eventId: 'event-1',
					tickets: [],
					event: {
						id: 'event-1',
						dateKey: '2026-11-20',
						startTime: new Date('2026-11-20T09:30:00Z'),
					},
				},
			],
		} as unknown as WalletSnapshot

		const event = restoreSnapshot(saved).groups[0].event

		expect(event?.localDate).toEqual({ year: 2026, month: 11, day: 20 })
		expect(event?.startTime).toBeUndefined()
	})

	it('leaves a list saved with wall-clock times as it is', () => {
		const saved = {
			saveTime: new Date('2026-11-01T00:00:00Z'),
			groups: [
				{
					eventId: 'event-1',
					tickets: [],
					event: {
						id: 'event-1',
						dateKey: '2026-11-20',
						localDate: { year: 2026, month: 11, day: 20 },
						startTime: { hour: 18, minute: 30 },
					},
				},
			],
		} as unknown as WalletSnapshot

		expect(restoreSnapshot(saved).groups[0]).toBe(saved.groups[0])
	})
})
