import { describe, expect, it } from 'vitest'
import { stripOwnUrlQuery } from './strip-own-url-query'

const ORIGIN = 'https://liverty-music.app'

describe('stripOwnUrlQuery', () => {
	it('removes the query and the fragment from the current address', () => {
		// @spec components/infrastructure/fan/web/global/analytics "Event on a referral link"
		const event = {
			event: 'concert_detail_viewed',
			properties: {
				$current_url: `${ORIGIN}/events/e-1?ref=member-a#tickets`,
				$pathname: '/events/e-1',
				event_id: 'e-1',
			},
		}

		const sent = stripOwnUrlQuery(event, ORIGIN)

		expect(sent?.properties).toEqual({
			$current_url: `${ORIGIN}/events/e-1`,
			$pathname: '/events/e-1',
			event_id: 'e-1',
		})
		// The event the SDK holds is not changed.
		expect(event.properties.$current_url).toContain('ref=member-a')
	})

	it('leaves no address of the visit carrying the code', () => {
		// @spec components/infrastructure/fan/web/global/analytics "First address of the visit"
		const event = {
			event: 'artist_search',
			properties: {
				$current_url: `${ORIGIN}/discovery`,
				$session_entry_url: `${ORIGIN}/events/e-1?ref=member-a`,
				$referrer: `${ORIGIN}/events/e-1?ref=member-a`,
				$set_once: {
					$initial_current_url: `${ORIGIN}/events/e-1?ref=member-a`,
				},
			},
			$set: { $current_url: `${ORIGIN}/events/e-1?ref=member-a` },
			$set_once: {
				$initial_current_url: `${ORIGIN}/events/e-1?ref=member-a`,
			},
		}

		const sent = stripOwnUrlQuery(event, ORIGIN)

		expect(JSON.stringify(sent)).not.toContain('ref=member-a')
		expect(sent?.properties.$session_entry_url).toBe(`${ORIGIN}/events/e-1`)
		expect(sent?.$set_once?.$initial_current_url).toBe(`${ORIGIN}/events/e-1`)
	})

	it("sends another site's address as it is", () => {
		// @spec components/infrastructure/fan/web/global/analytics "Another site's address"
		const event = {
			event: 'concert_detail_viewed',
			properties: {
				$referrer: 'https://x.com/some/post?s=20',
				$initial_referrer: 'https://x.com/some/post?s=20',
			},
		}

		const sent = stripOwnUrlQuery(event, ORIGIN)

		expect(sent?.properties.$referrer).toBe('https://x.com/some/post?s=20')
		expect(sent?.properties.$initial_referrer).toBe(
			'https://x.com/some/post?s=20',
		)
	})

	it('keeps an address on a look-alike host', () => {
		const value = `${ORIGIN}.evil.example/events/e-1?ref=member-a`
		const sent = stripOwnUrlQuery({ properties: { $referrer: value } }, ORIGIN)
		expect(sent?.properties?.$referrer).toBe(value)
	})

	it('keeps non-address values and passes a dropped event through', () => {
		const sent = stripOwnUrlQuery(
			{ properties: { query_length: 3, tags: ['a', null], note: 'ref=x' } },
			ORIGIN,
		)
		expect(sent?.properties).toEqual({
			query_length: 3,
			tags: ['a', null],
			note: 'ref=x',
		})
		expect(stripOwnUrlQuery(null, ORIGIN)).toBeNull()
	})
})
