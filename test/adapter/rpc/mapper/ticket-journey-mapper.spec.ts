import { describe, expect, it, vi } from 'vitest'

vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_journey_pb.js',
	() => ({
		TicketJourneyStatus: {
			UNSPECIFIED: 0,
			TRACKING: 1,
			APPLIED: 2,
			LOST: 3,
			UNPAID: 4,
			PAID: 5,
		},
	}),
)

const { journeyStatusFrom, journeyStatusTo } = await import(
	'../../../../src/adapter/rpc/mapper/ticket-journey-mapper'
)

describe('journeyStatusFrom', () => {
	it.each([
		{ proto: 1, expected: 'tracking' },
		{ proto: 2, expected: 'applied' },
		{ proto: 3, expected: 'lost' },
		{ proto: 4, expected: 'unpaid' },
		{ proto: 5, expected: 'paid' },
	])('maps proto $proto to $expected', ({ proto, expected }) => {
		expect(journeyStatusFrom(proto as any)).toBe(expected)
	})

	it('returns undefined for UNSPECIFIED (0)', () => {
		expect(journeyStatusFrom(0 as any)).toBeUndefined()
	})

	it('returns undefined for unknown value', () => {
		expect(journeyStatusFrom(99 as any)).toBeUndefined()
	})
})

describe('journeyStatusTo', () => {
	it.each([
		{ entity: 'tracking' as const, expected: 1 },
		{ entity: 'applied' as const, expected: 2 },
		{ entity: 'lost' as const, expected: 3 },
		{ entity: 'unpaid' as const, expected: 4 },
		{ entity: 'paid' as const, expected: 5 },
	])('maps $entity to proto $expected', ({ entity, expected }) => {
		expect(journeyStatusTo(entity)).toBe(expected)
	})
})

describe('journeyStatusFrom + journeyStatusTo round-trip', () => {
	it.each([
		'tracking',
		'applied',
		'lost',
		'unpaid',
		'paid',
	] as const)('round-trips %s', (status) => {
		expect(journeyStatusFrom(journeyStatusTo(status))).toBe(status)
	})
})
