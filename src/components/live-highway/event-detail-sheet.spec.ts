import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JourneyStatus } from '../../entities/concert'
import type { LiveEvent } from './live-event'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}
const mockAuth = { isAuthenticated: true }
const mockHistory = { pushState: vi.fn(), replaceState: vi.fn() }
const mockAnalytics = { capture: vi.fn() }

// A store mock backed by a real map so `statusFor` reflects write-through writes,
// exactly like the single-source-of-truth store.
const journey = new Map<string, JourneyStatus>()
const mockJourneyStore = {
	statusFor: vi.fn((id?: string) => (id ? journey.get(id) : undefined)),
	setStatus: vi.fn(async (id: string, status: JourneyStatus) => {
		journey.set(id, status)
	}),
	delete: vi.fn(async (id: string) => {
		journey.delete(id)
	}),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IAuthService: mockAuth,
				ITicketJourneyStore: mockJourneyStore,
				IHistory: mockHistory,
				IAnalyticsService: mockAnalytics,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		bindable: actual.bindable,
	}
})

import { EventDetailSheet } from './event-detail-sheet'

function makeEvent(id: string): LiveEvent {
	return { id, journeyStatus: undefined } as LiveEvent
}

describe('EventDetailSheet — journey via the store', () => {
	let sut: EventDetailSheet

	beforeEach(() => {
		vi.clearAllMocks()
		journey.clear()
		sut = new EventDetailSheet()
		sut.event = makeEvent('e1')
	})

	it('reads status from the store, not a local event copy', () => {
		expect(sut.status).toBeUndefined()
		journey.set('e1', 'applied')
		expect(sut.status).toBe('applied')
	})

	it('writes through the store on setJourneyStatus and reflects it via status', async () => {
		await sut.setJourneyStatus('applied')

		expect(mockJourneyStore.setStatus).toHaveBeenCalledWith('e1', 'applied')
		// Read side reflects the write from the same store — no local mutation.
		expect(sut.status).toBe('applied')
		expect((sut.event as LiveEvent).journeyStatus).toBeUndefined()
	})

	it('write-through delete clears the status', async () => {
		await sut.setJourneyStatus('applied')
		await sut.removeJourney()

		expect(mockJourneyStore.delete).toHaveBeenCalledWith('e1')
		expect(sut.status).toBeUndefined()
	})

	it('does not double-fire while a write is in flight', async () => {
		let release: () => void = () => {}
		mockJourneyStore.setStatus.mockImplementationOnce(
			() =>
				new Promise<void>((r) => {
					release = () => r()
				}),
		)

		const first = sut.setJourneyStatus('applied')
		await sut.setJourneyStatus('paid') // guarded out while updating
		release()
		await first

		expect(mockJourneyStore.setStatus).toHaveBeenCalledTimes(1)
	})
})

describe('EventDetailSheet — history management', () => {
	let sut: EventDetailSheet

	beforeEach(() => {
		vi.clearAllMocks()
		window.history.replaceState(null, '', '/dashboard')
		sut = new EventDetailSheet()
	})

	it('pushes/restores the URL by default (dashboard context)', () => {
		sut.open(makeEvent('e1'))
		expect(mockHistory.pushState).toHaveBeenCalledWith(
			{ concertId: 'e1' },
			'',
			'/concerts/e1',
		)
		sut.close()
		expect(mockHistory.replaceState).toHaveBeenCalledWith(
			null,
			'',
			'/dashboard',
		)
	})

	// @spec components/infrastructure/fan/web/route/dashboard "Closing keeps the active filters in the URL"
	it('closes back to the filtered dashboard URL it opened from', () => {
		window.history.replaceState(
			null,
			'',
			'/dashboard?artists=a1,a2&journey=applied&from=2026-10-01',
		)
		sut.open(makeEvent('e1'))
		sut.close()
		expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
			null,
			'',
			'/dashboard?artists=a1,a2&journey=applied&from=2026-10-01',
		)
	})

	// @spec components/infrastructure/fan/web/route/dashboard "Closing keeps the active filters in the URL"
	it('reverts to the recorded dashboard URL when the bottom sheet reports it closed', () => {
		// Light dismiss and swipe down both surface as the bottom sheet's
		// sheet-closed event, which the sheet handles in onSheetClosed().
		window.history.replaceState(null, '', '/dashboard?artists=a1')
		sut.open(makeEvent('e1'))
		sut.onSheetClosed()
		expect(sut.isOpen).toBe(false)
		expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
			null,
			'',
			'/dashboard?artists=a1',
		)
	})

	it('keeps the URL from before the first concert when another opens over it', () => {
		window.history.replaceState(null, '', '/dashboard?artists=a1')
		sut.open(makeEvent('e1'))
		// The sheet pushed its own URL; opening another concert must not record it.
		window.history.replaceState(null, '', '/concerts/e1')
		sut.open(makeEvent('e2'))
		sut.close()
		expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
			null,
			'',
			'/dashboard?artists=a1',
		)
	})

	it('falls back to /dashboard when it opened from a non-dashboard URL', () => {
		window.history.replaceState(null, '', '/concerts/e1')
		sut.open(makeEvent('e1'))
		sut.close()
		expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
			null,
			'',
			'/dashboard',
		)
	})

	it('never touches history when manageHistory is false (landing page)', () => {
		sut.manageHistory = false
		sut.open(makeEvent('e2'))
		expect(mockHistory.pushState).not.toHaveBeenCalled()
		sut.close()
		expect(mockHistory.replaceState).not.toHaveBeenCalled()
		// Still opens/closes normally.
		expect(sut.isOpen).toBe(false)
	})
})
