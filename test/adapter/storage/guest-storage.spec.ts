import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	loadFollows,
	loadHome,
	saveFollows,
	saveHome,
} from '../../../src/adapter/storage/guest-storage'
import type { GuestFollow } from '../../../src/entities/follow'

function makeFollow(
	id: string,
	name: string,
	home: string | null = null,
): GuestFollow {
	return { artist: { id, name, mbid: '' }, home }
}

beforeEach(() => {
	localStorage.clear()
})

afterEach(() => {
	localStorage.clear()
})

describe('saveFollows / loadFollows', () => {
	it('should round-trip follows through localStorage', () => {
		const follows = [
			makeFollow('a1', 'Artist One', 'tokyo'),
			makeFollow('a2', 'Artist Two'),
		]

		saveFollows(follows)
		const result = loadFollows()

		expect(result).toHaveLength(2)
		expect(result[0].artist.id).toBe('a1')
		expect(result[0].artist.name).toBe('Artist One')
		expect(result[0].home).toBe('tokyo')
		expect(result[1].artist.id).toBe('a2')
		expect(result[1].home).toBeNull()
	})

	it('should save and load empty array', () => {
		saveFollows([])
		expect(loadFollows()).toEqual([])
	})

	it('should preserve null home', () => {
		saveFollows([makeFollow('a1', 'Artist')])
		const result = loadFollows()
		expect(result[0].home).toBeNull()
	})

	it('should preserve fanart data', () => {
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
		saveFollows(follows)
		const result = loadFollows()
		expect(result[0].artist.fanart?.hdMusicLogo).toBe('hd.png')
		expect(result[0].artist.fanart?.logoColorProfile?.dominantHue).toBe(120)
	})

	it('should return empty array when localStorage is empty', () => {
		expect(loadFollows()).toEqual([])
	})

	it('should return empty array for invalid JSON', () => {
		localStorage.setItem('guest.followedArtists', 'not json')
		expect(loadFollows()).toEqual([])
	})

	it('should return empty array for non-array JSON', () => {
		localStorage.setItem('guest.followedArtists', '{"key":"val"}')
		expect(loadFollows()).toEqual([])
	})

	it('should filter out entries missing artist.id or artist.name', () => {
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{ artist: { id: 'a1', name: 'Valid' }, home: null },
				{ artist: { id: 123, name: 'Bad ID' }, home: null },
				{ artist: {}, home: null },
				{ notArtist: true },
			]),
		)
		const result = loadFollows()
		expect(result).toHaveLength(1)
		expect(result[0].artist.id).toBe('a1')
	})

	it('should filter out null entries', () => {
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([null, { artist: { id: 'a1', name: 'X' }, home: null }]),
		)
		const result = loadFollows()
		expect(result).toHaveLength(1)
		expect(result[0].artist.id).toBe('a1')
	})
})

describe('saveHome / loadHome', () => {
	it('should save and load a home code', () => {
		saveHome('JP-13')
		expect(loadHome()).toBe('JP-13')
	})

	it('should return null when no home is stored', () => {
		expect(loadHome()).toBeNull()
	})

	it('should remove home from localStorage when saving null', () => {
		saveHome('JP-13')
		saveHome(null)
		expect(loadHome()).toBeNull()
		expect(localStorage.getItem('guest.home')).toBeNull()
	})
})
