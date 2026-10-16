import { beforeEach, describe, expect, it } from 'vitest'
import {
	PENDING_RETURN_TTL_MS,
	savePendingReturn,
	takePendingReturn,
} from '../../../organizer/adapter/storage/pending-return-storage'

describe('pending return storage', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	it('returns the remembered address once', () => {
		savePendingReturn('/organizers/o-1/settings', 1_000)
		expect(takePendingReturn(2_000)).toBe('/organizers/o-1/settings')
		expect(takePendingReturn(2_000)).toBeNull()
	})

	it('ignores an address past its time limit', () => {
		savePendingReturn('/organizers/o-1', 0)
		expect(takePendingReturn(PENDING_RETURN_TTL_MS + 1)).toBeNull()
	})

	it('ignores a malformed entry', () => {
		localStorage.setItem('organizer.pendingReturn', '{oops')
		expect(takePendingReturn()).toBeNull()
		localStorage.setItem(
			'organizer.pendingReturn',
			JSON.stringify({ path: 7, exp: 1 }),
		)
		expect(takePendingReturn(0)).toBeNull()
	})
})
