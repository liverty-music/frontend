import { describe, expect, it } from 'vitest'
import { ARTIST_WRITES, FOLLOW_WRITES, isRpcMethod } from './rpc-write-route'

const FOLLOW = 'liverty_music.rpc.follow.v1.FollowService'
const ARTIST = 'liverty_music.rpc.artist.v1.ArtistService'

describe('isRpcMethod', () => {
	it('matches the write methods of a service', () => {
		for (const m of ['Follow', 'Unfollow', 'SetHype']) {
			expect(isRpcMethod(`/${FOLLOW}/${m}`, FOLLOW, FOLLOW_WRITES)).toBe(true)
		}
		expect(isRpcMethod(`/${ARTIST}/Create`, ARTIST, ARTIST_WRITES)).toBe(true)
	})

	it('leaves reads to the network', () => {
		expect(isRpcMethod(`/${FOLLOW}/List`, FOLLOW, FOLLOW_WRITES)).toBe(false)
		for (const m of ['List', 'Search', 'ListSimilar', 'ListTop']) {
			expect(isRpcMethod(`/${ARTIST}/${m}`, ARTIST, ARTIST_WRITES)).toBe(false)
		}
	})

	it('does not match another service with the same method name', () => {
		expect(
			isRpcMethod(
				'/liverty_music.rpc.other.v1.OtherFollowService/Follow',
				FOLLOW,
				FOLLOW_WRITES,
			),
		).toBe(false)
	})
})
