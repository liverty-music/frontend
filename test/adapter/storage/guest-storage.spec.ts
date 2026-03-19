import { describe, expect, it } from 'vitest'
import {
	deserializeGuestFollows,
	serializeGuestFollows,
} from '../../../src/adapter/storage/guest-storage'
import type { GuestFollow } from '../../../src/state/app-state'

function makeFollow(
	id: string,
	name: string,
	home: string | null = null,
): GuestFollow {
	return { artist: { id, name, mbid: '' }, home }
}

describe('serializeGuestFollows', () => {
	it('serializes follows to JSON', () => {
		const follows = [makeFollow('a1', 'Artist One', 'tokyo')]
		const json = serializeGuestFollows(follows)
		const parsed = JSON.parse(json)

		expect(parsed).toHaveLength(1)
		expect(parsed[0].artist.id).toBe('a1')
		expect(parsed[0].artist.name).toBe('Artist One')
		expect(parsed[0].home).toBe('tokyo')
	})

	it('serializes empty array', () => {
		expect(serializeGuestFollows([])).toBe('[]')
	})

	it('preserves null home', () => {
		const follows = [makeFollow('a1', 'Artist')]
		const parsed = JSON.parse(serializeGuestFollows(follows))
		expect(parsed[0].home).toBeNull()
	})

	it('preserves fanart data', () => {
		const follows: GuestFollow[] = [
			{
				artist: {
					id: 'a1',
					name: 'Artist',
					mbid: 'mb1',
					fanart: {
						hdMusicLogo: 'hd.png',
						logoColorProfile: {
							dominantHue: 120,
							dominantLightness: 0.5,
							isChromatic: true,
						},
					},
				},
				home: null,
			},
		]
		const parsed = JSON.parse(serializeGuestFollows(follows))
		expect(parsed[0].artist.fanart.hdMusicLogo).toBe('hd.png')
		expect(parsed[0].artist.fanart.logoColorProfile.dominantHue).toBe(120)
	})
})

describe('deserializeGuestFollows', () => {
	describe('new flat format', () => {
		it('deserializes correctly', () => {
			const json = JSON.stringify([
				{
					artist: { id: 'a1', name: 'Artist One', mbid: 'mb1' },
					home: 'tokyo',
				},
			])
			const result = deserializeGuestFollows(json)

			expect(result).toHaveLength(1)
			expect(result[0].artist.id).toBe('a1')
			expect(result[0].artist.name).toBe('Artist One')
			expect(result[0].artist.mbid).toBe('mb1')
			expect(result[0].home).toBe('tokyo')
		})

		it('defaults name and mbid to empty string', () => {
			const json = JSON.stringify([{ artist: { id: 'a1' }, home: null }])
			const result = deserializeGuestFollows(json)

			expect(result[0].artist.name).toBe('')
			expect(result[0].artist.mbid).toBe('')
		})

		it('handles missing home field', () => {
			const json = JSON.stringify([
				{ artist: { id: 'a1', name: 'X', mbid: '' } },
			])
			const result = deserializeGuestFollows(json)
			expect(result[0].home).toBeNull()
		})
	})

	describe('legacy proto VO format', () => {
		it('unwraps { value: "..." } wrappers', () => {
			const json = JSON.stringify([
				{
					artist: {
						id: { value: 'a1' },
						name: { value: 'Artist One' },
						mbid: { value: 'mb1' },
					},
					home: null,
				},
			])
			const result = deserializeGuestFollows(json)

			expect(result).toHaveLength(1)
			expect(result[0].artist.id).toBe('a1')
			expect(result[0].artist.name).toBe('Artist One')
			expect(result[0].artist.mbid).toBe('mb1')
		})

		it('skips entry when VO id has no value', () => {
			const json = JSON.stringify([
				{
					artist: { id: { value: undefined }, name: { value: 'X' } },
					home: null,
				},
			])
			const result = deserializeGuestFollows(json)
			expect(result).toHaveLength(0)
		})
	})

	describe('legacy flat format (artistId)', () => {
		it('maps artistId to artist.id', () => {
			const json = JSON.stringify([{ artistId: 'a1', name: 'Artist One' }])
			const result = deserializeGuestFollows(json)

			expect(result).toHaveLength(1)
			expect(result[0].artist.id).toBe('a1')
			expect(result[0].artist.name).toBe('Artist One')
			expect(result[0].artist.mbid).toBe('')
			expect(result[0].home).toBeNull()
		})

		it('defaults name to empty string when missing', () => {
			const json = JSON.stringify([{ artistId: 'a1' }])
			const result = deserializeGuestFollows(json)
			expect(result[0].artist.name).toBe('')
		})
	})

	describe('legacy direct format (id at top level)', () => {
		it('maps top-level id/name to artist', () => {
			const json = JSON.stringify([
				{ id: 'artist-1', name: 'YOASOBI', passionLevel: 'MUST_GO' },
			])
			const result = deserializeGuestFollows(json)

			expect(result).toHaveLength(1)
			expect(result[0].artist.id).toBe('artist-1')
			expect(result[0].artist.name).toBe('YOASOBI')
			expect(result[0].artist.mbid).toBe('')
			expect(result[0].home).toBeNull()
		})
	})

	describe('corrupt / invalid data', () => {
		it('returns empty array for invalid JSON', () => {
			expect(deserializeGuestFollows('not json')).toEqual([])
		})

		it('returns empty array for non-array JSON', () => {
			expect(deserializeGuestFollows('{"key":"val"}')).toEqual([])
		})

		it('returns empty array for empty string', () => {
			expect(deserializeGuestFollows('')).toEqual([])
		})

		it('filters out null entries', () => {
			const json = JSON.stringify([
				null,
				{ artist: { id: 'a1', name: 'X', mbid: '' } },
			])
			const result = deserializeGuestFollows(json)
			expect(result).toHaveLength(1)
			expect(result[0].artist.id).toBe('a1')
		})

		it('filters out entries without recognizable format', () => {
			const json = JSON.stringify([{ foo: 'bar' }])
			const result = deserializeGuestFollows(json)
			expect(result).toHaveLength(0)
		})

		it('filters out entries with empty artist object', () => {
			const json = JSON.stringify([{ artist: {} }])
			const result = deserializeGuestFollows(json)
			expect(result).toHaveLength(0)
		})
	})

	describe('round-trip', () => {
		it('serialize then deserialize preserves data', () => {
			const original: GuestFollow[] = [
				makeFollow('a1', 'Artist One', 'tokyo'),
				makeFollow('a2', 'Artist Two'),
			]
			const result = deserializeGuestFollows(serializeGuestFollows(original))

			expect(result).toHaveLength(2)
			expect(result[0].artist.id).toBe('a1')
			expect(result[0].artist.name).toBe('Artist One')
			expect(result[0].home).toBe('tokyo')
			expect(result[1].artist.id).toBe('a2')
			expect(result[1].home).toBeNull()
		})
	})
})
