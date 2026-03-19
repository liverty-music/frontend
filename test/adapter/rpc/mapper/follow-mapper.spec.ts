import { describe, expect, it, vi } from 'vitest'

// Mock the proto enum before importing the mapper
vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js',
	() => ({
		HypeType: {
			UNSPECIFIED: 0,
			WATCH: 1,
			HOME: 2,
			NEARBY: 3,
			AWAY: 4,
		},
	}),
)

const { hypeFrom, hypeTo } = await import(
	'../../../../src/adapter/rpc/mapper/follow-mapper'
)

describe('hypeFrom', () => {
	it('maps WATCH to watch', () => {
		expect(hypeFrom(1)).toBe('watch')
	})

	it('maps HOME to home', () => {
		expect(hypeFrom(2)).toBe('home')
	})

	it('maps NEARBY to nearby', () => {
		expect(hypeFrom(3)).toBe('nearby')
	})

	it('maps AWAY to away', () => {
		expect(hypeFrom(4)).toBe('away')
	})

	it('defaults to watch for undefined', () => {
		expect(hypeFrom(undefined)).toBe('watch')
	})

	it('defaults to watch for UNSPECIFIED (0)', () => {
		expect(hypeFrom(0 as any)).toBe('watch')
	})

	it('defaults to watch for unknown value', () => {
		expect(hypeFrom(99 as any)).toBe('watch')
	})
})

describe('hypeTo', () => {
	it('maps watch to WATCH (1)', () => {
		expect(hypeTo('watch')).toBe(1)
	})

	it('maps home to HOME (2)', () => {
		expect(hypeTo('home')).toBe(2)
	})

	it('maps nearby to NEARBY (3)', () => {
		expect(hypeTo('nearby')).toBe(3)
	})

	it('maps away to AWAY (4)', () => {
		expect(hypeTo('away')).toBe(4)
	})
})

describe('hypeFrom + hypeTo round-trip', () => {
	it.each([
		'watch',
		'home',
		'nearby',
		'away',
	] as const)('round-trips %s', (hype) => {
		expect(hypeFrom(hypeTo(hype))).toBe(hype)
	})
})
