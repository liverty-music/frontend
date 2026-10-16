import { describe, expect, it } from 'vitest'
import {
	GUEST_MERGED_RECEIPT_PREFIX,
	guestMergedReceiptKey,
	SessionKeys,
	StorageKeys,
} from './storage-keys'

// Storage names carry no product prefix (OpenSpec `referral-attribution`,
// design D9). The specs name these keys, so a rename is a spec change.
describe('storage names', () => {
	it('names the localStorage keys the specs name', () => {
		expect(StorageKeys.postSignupShown).toBe('postSignup.shown')
		expect(StorageKeys.soundMuted).toBe('sound.muted')
		expect(StorageKeys.soundVolume).toBe('sound.volume')
		expect(StorageKeys.beamsEnabled).toBe('beams.enabled')
		expect(StorageKeys.fabHanded).toBe('fab.handed')
		expect(guestMergedReceiptKey('user-1')).toBe('guestMerged:user-1')
		expect(GUEST_MERGED_RECEIPT_PREFIX).toBe('guestMerged:')
	})

	it('names the sessionStorage keys', () => {
		expect(SessionKeys).toEqual({
			languageBackfillAttempted: 'lang.backfillAttempted',
			followReconcileAttempted: 'follow.reconcileAttempted',
			pwaBannerDismissed: 'pwaBanner.dismissed',
		})
	})
})
