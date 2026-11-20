import { describe, expect, it } from 'vitest'
import { fanPageUrlOf } from '../../../organizer/model/concert-model'

describe('fanPageUrlOf', () => {
	it('is the concert page on the fan origin of the environment', () => {
		expect(fanPageUrlOf('prod', 'e-1103')).toBe(
			'https://liverty-music.app/concerts/e-1103',
		)
		expect(fanPageUrlOf('dev', 'e-1103')).toBe(
			'https://dev.liverty-music.app/concerts/e-1103',
		)
	})
})
