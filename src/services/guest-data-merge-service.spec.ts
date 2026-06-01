import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

const mockGuest = {
	clearOnboardingExceptFollows: vi.fn(),
	clearFollows: vi.fn(),
	clearAll: vi.fn(),
}

const mockOnboarding = {
	complete: vi.fn(),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IGuestService: mockGuest,
				IOnboardingService: mockOnboarding,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { GuestDataMergeService } from './guest-data-merge-service'

describe('GuestDataMergeService (Phase 2 hand-over)', () => {
	let sut: GuestDataMergeService

	beforeEach(() => {
		vi.clearAllMocks()
		sut = new GuestDataMergeService()
	})

	it('completes onboarding on the sign-up hand-off', async () => {
		await sut.merge()
		expect(mockOnboarding.complete).toHaveBeenCalledOnce()
	})

	it('clears non-follow guest preferences (home/language/help-seen)', async () => {
		await sut.merge()
		expect(mockGuest.clearOnboardingExceptFollows).toHaveBeenCalledOnce()
	})

	it('does NOT clear the guest follow queue (FollowStore drains it per-item)', async () => {
		await sut.merge()
		expect(mockGuest.clearFollows).not.toHaveBeenCalled()
		expect(mockGuest.clearAll).not.toHaveBeenCalled()
	})
})
