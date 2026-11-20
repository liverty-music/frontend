import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Concert, JourneyStatus } from '../../entities/concert'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}
const mockAuth = { isAuthenticated: true }
const mockHistory = { pushState: vi.fn(), replaceState: vi.fn() }
const mockAnalytics = { capture: vi.fn() }
const mockNotificationPrompt = {
	pushState: vi.fn(async () => 'on'),
	accept: vi.fn(async () => 'granted'),
}

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
				// Key actions add a step for the error report.
				IErrorBoundaryService: { addBreadcrumb: () => {} },
				IAuthService: mockAuth,
				ITicketJourneyStore: mockJourneyStore,
				IHistory: mockHistory,
				IAnalyticsService: mockAnalytics,
				INotificationPromptService: mockNotificationPrompt,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		bindable: actual.bindable,
	}
})

import { ConcertSheet } from './concert-sheet'

function makeEvent(id: string): Concert {
	return { id, journeyStatus: undefined } as Concert
}

describe('ConcertSheet — journey via the store', () => {
	let sut: ConcertSheet

	beforeEach(() => {
		vi.clearAllMocks()
		journey.clear()
		sut = new ConcertSheet()
		sut.event = makeEvent('e1')
	})

	it('reads status from the store, not a local event copy', () => {
		// @spec components/infrastructure/fan/web/route/timetable "Display ticket journey status"
		expect(sut.status).toBeUndefined()
		journey.set('e1', 'applied')
		expect(sut.status).toBe('applied')
	})

	it('writes through the store on setJourneyStatus and reflects it via status', async () => {
		// @spec components/infrastructure/fan/web/route/timetable "Set ticket journey status from detail view"
		await sut.setJourneyStatus('applied')

		expect(mockJourneyStore.setStatus).toHaveBeenCalledWith('e1', 'applied')
		// Read side reflects the write from the same store — no local mutation.
		expect(sut.status).toBe('applied')
		expect((sut.event as Concert).journeyStatus).toBeUndefined()
	})

	it('write-through delete clears the status', async () => {
		// @spec components/infrastructure/fan/web/route/timetable "Remove ticket journey from detail view"
		await sut.setJourneyStatus('applied')
		await sut.removeJourney()

		expect(mockJourneyStore.delete).toHaveBeenCalledWith('e1')
		expect(sut.status).toBeUndefined()
	})

	it('starts tracking a concert that has no journey yet', async () => {
		// @spec components/infrastructure/fan/web/route/timetable "Start tracking from detail view"
		expect(sut.status).toBeUndefined()

		await sut.setJourneyStatus('tracking')

		expect(mockJourneyStore.setStatus).toHaveBeenCalledWith('e1', 'tracking')
		expect(sut.status).toBe('tracking')
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

describe('ConcertSheet — history management', () => {
	let sut: ConcertSheet

	beforeEach(() => {
		vi.clearAllMocks()
		window.history.replaceState(null, '', '/timetable')
		sut = new ConcertSheet()
	})

	it('pushes/restores the URL by default (timetable context)', () => {
		sut.open(makeEvent('e1'))
		expect(mockHistory.pushState).toHaveBeenCalledWith(
			{ concertId: 'e1' },
			'',
			'/timetable?concert=e1',
		)
		sut.close()
		expect(mockHistory.replaceState).toHaveBeenCalledWith(
			null,
			'',
			'/timetable',
		)
	})

	// @spec components/infrastructure/fan/web/route/discovery "Closing the detail sheet returns to the list"
	it('closes back to the Concerts view on Discovery it opened from', () => {
		window.history.replaceState(null, '', '/discovery?view=concerts')
		sut.open(makeEvent('e1'), 'discovery_concerts', true)
		expect(mockHistory.pushState).toHaveBeenLastCalledWith(
			{ concertId: 'e1' },
			'',
			'/discovery?view=concerts&concert=e1',
		)
		sut.onSheetClosed()
		expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
			null,
			'',
			'/discovery?view=concerts',
		)
	})

	// @spec components/infrastructure/fan/web/route/timetable "Closing the deep-linked sheet does not reload the timetable"
	it('closes a deep-linked sheet to the timetable', () => {
		window.history.replaceState(null, '', '/timetable?concert=e1')
		sut.open(makeEvent('e1'))
		sut.close()
		expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
			null,
			'',
			'/timetable',
		)
	})

	// @spec components/infrastructure/fan/web/route/timetable "Closing keeps the active filters in the URL"
	it('closes back to the filtered timetable URL it opened from', () => {
		window.history.replaceState(
			null,
			'',
			'/timetable?artists=a1,a2&journey=applied&from=2026-10-01',
		)
		sut.open(makeEvent('e1'))
		sut.close()
		expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
			null,
			'',
			'/timetable?artists=a1,a2&journey=applied&from=2026-10-01',
		)
	})

	// @spec components/infrastructure/fan/web/route/timetable "Closing keeps the active filters in the URL"
	it('reverts to the recorded timetable URL when the bottom sheet reports it closed', () => {
		// Light dismiss and swipe down both surface as the bottom sheet's
		// sheet-closed event, which the sheet handles in onSheetClosed().
		window.history.replaceState(null, '', '/timetable?artists=a1')
		sut.open(makeEvent('e1'))
		sut.onSheetClosed()
		expect(sut.isOpen).toBe(false)
		expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
			null,
			'',
			'/timetable?artists=a1',
		)
	})

	it('keeps the URL from before the first concert when another opens over it', () => {
		window.history.replaceState(null, '', '/timetable?artists=a1')
		sut.open(makeEvent('e1'))
		// The sheet pushed its own URL; opening another concert must not record it.
		window.history.replaceState(null, '', '/timetable?artists=a1&concert=e1')
		sut.open(makeEvent('e2'))
		sut.close()
		expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
			null,
			'',
			'/timetable?artists=a1',
		)
	})

	it('leaves the concert parameter out of the address it closes to', () => {
		window.history.replaceState(null, '', '/timetable?concert=e1&artists=a1')
		sut.open(makeEvent('e1'))
		expect(mockHistory.pushState).toHaveBeenLastCalledWith(
			{ concertId: 'e1' },
			'',
			'/timetable?artists=a1&concert=e1',
		)
		sut.close()
		expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
			null,
			'',
			'/timetable?artists=a1',
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
