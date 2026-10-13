import { describe, expect, it } from 'vitest'
import { fanOriginOf } from '../../../shared/config/known-hosts'

describe('fanOriginOf', () => {
	it('gives the fan origin each environment serves', () => {
		expect(fanOriginOf('prod')).toBe('https://liverty-music.app')
		expect(fanOriginOf('dev')).toBe('https://dev.liverty-music.app')
		expect(fanOriginOf('staging')).toBe('https://staging.liverty-music.app')
	})
})
