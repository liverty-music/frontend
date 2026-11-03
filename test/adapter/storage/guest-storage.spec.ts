import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	loadFollows,
	loadHome,
	saveFollows,
	saveHome,
} from '../../../src/adapter/storage/guest-storage'
import {
	DEFAULT_HYPE,
	type FollowedArtist,
	type GuestFollowedArtist,
} from '../../../src/entities/follow'

function makeFollow(
	id: string,
	name: string,
	hype: FollowedArtist['hype'] = DEFAULT_HYPE,
	hypeSetBy: GuestFollowedArtist['hypeSetBy'] = 'default',
): GuestFollowedArtist {
	return { artist: { id, name, mbid: '' }, hype, hypeSetBy }
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
			makeFollow('a1', 'Artist One', 'home'),
			makeFollow('a2', 'Artist Two'),
		]

		saveFollows(follows)
		const result = loadFollows()

		expect(result).toHaveLength(2)
		expect(result[0].artist.id).toBe('a1')
		expect(result[0].artist.name).toBe('Artist One')
		expect(result[0].hype).toBe('home')
		expect(result[1].artist.id).toBe('a2')
		expect(result[1].hype).toBe(DEFAULT_HYPE)
	})

	it('should save and load empty array', () => {
		saveFollows([])
		expect(loadFollows()).toEqual([])
	})

	it('should default hype to DEFAULT_HYPE', () => {
		saveFollows([makeFollow('a1', 'Artist')])
		const result = loadFollows()
		expect(result[0].hype).toBe(DEFAULT_HYPE)
	})

	it('should preserve fanart data', () => {
		const follows: GuestFollowedArtist[] = [
			{
				artist: {
					id: 'a1',
					name: 'Artist',
					mbid: 'mb1',
					fanart: {
						artistBackground: 'bg.png',
						artistThumb: 'thumb.png',
					},
				},
				hype: 'away',
				hypeSetBy: 'fan',
			},
		]
		saveFollows(follows)
		const result = loadFollows()
		expect(result[0].artist.fanart?.artistBackground).toBe('bg.png')
		expect(result[0].artist.fanart?.artistThumb).toBe('thumb.png')
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
				{ artist: { id: 'a1', name: 'Valid' }, hype: 'watch' },
				{ artist: { id: 123, name: 'Bad ID' }, hype: 'watch' },
				{ artist: {}, hype: 'watch' },
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
			JSON.stringify([
				null,
				{ artist: { id: 'a1', name: 'X' }, hype: 'watch' },
			]),
		)
		const result = loadFollows()
		expect(result).toHaveLength(1)
		expect(result[0].artist.id).toBe('a1')
	})

	// @spec stories/merge-guest-data-on-signup "Followed artists stored locally with hype"
	it('round-trips who set each hype level', () => {
		saveFollows([
			makeFollow('a1', 'Chosen Nearby', DEFAULT_HYPE, 'fan'),
			makeFollow('a2', 'Default'),
		])

		expect(loadFollows().map((f) => [f.hype, f.hypeSetBy])).toEqual([
			[DEFAULT_HYPE, 'fan'],
			[DEFAULT_HYPE, 'default'],
		])
	})

	// @spec stories/merge-guest-data-on-signup "Legacy data read with hype fallback"
	it('reads an entry without hypeSetBy as set by the fan when its hype differs from the default, else by default', () => {
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{ artist: { id: 'a1', name: 'Away' }, hype: 'away' },
				{ artist: { id: 'a2', name: 'Nearby' }, hype: DEFAULT_HYPE },
				{ artist: { id: 'a3', name: 'Legacy' }, home: null },
			]),
		)

		expect(
			loadFollows().map((f) => [f.artist.id, f.hype, f.hypeSetBy]),
		).toEqual([
			['a1', 'away', 'fan'],
			['a2', DEFAULT_HYPE, 'default'],
			['a3', DEFAULT_HYPE, 'default'],
		])
	})

	// @spec stories/merge-guest-data-on-signup "Legacy data read with hype fallback"
	it('should fall back to DEFAULT_HYPE for legacy GuestFollow entries without hype', () => {
		// Simulate old format: { artist, home } without hype field
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([{ artist: { id: 'a1', name: 'Legacy' }, home: null }]),
		)
		const result = loadFollows()
		expect(result).toHaveLength(1)
		expect(result[0].hype).toBe(DEFAULT_HYPE)
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
