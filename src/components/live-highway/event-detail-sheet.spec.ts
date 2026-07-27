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
