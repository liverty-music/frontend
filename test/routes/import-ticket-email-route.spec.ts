import type { RouteNode } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'

const mockIConcertService = DI.createInterface('IConcertService')
const mockIFollowServiceClient = DI.createInterface('IFollowServiceClient')
const mockITicketEmailService = DI.createInterface('ITicketEmailService')

vi.mock('../../src/services/concert-service', () => ({
	IConcertService: mockIConcertService,
}))
vi.mock('../../src/services/follow-service-client', () => ({
	IFollowServiceClient: mockIFollowServiceClient,
}))
vi.mock('../../src/services/ticket-email-service', () => ({
	ITicketEmailService: mockITicketEmailService,
}))

vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_journey_pb.js',
	() => ({
		TicketJourneyStatus: {
			TRACKING: 0,
			APPLIED: 1,
			LOST: 2,
			UNPAID: 3,
			PAID: 4,
		},
	}),
)

const { ImportTicketEmailRoute } = await import(
	'../../src/routes/import-ticket-email/import-ticket-email-route'
)

function makeNext(params: Record<string, string>): RouteNode {
	return { queryParams: new URLSearchParams(params) } as unknown as RouteNode
}

describe('ImportTicketEmailRoute', () => {
	let sut: InstanceType<typeof ImportTicketEmailRoute>
	let mockFollow: { listFollowed: ReturnType<typeof vi.fn> }
	let mockConcert: { listConcerts: ReturnType<typeof vi.fn> }
	let mockTicketEmail: {
		create: ReturnType<typeof vi.fn>
		update: ReturnType<typeof vi.fn>
	}

	beforeEach(async () => {
		mockFollow = {
			listFollowed: vi.fn().mockResolvedValue([]),
		}
		mockConcert = {
			listConcerts: vi.fn().mockResolvedValue([]),
		}
		mockTicketEmail = {
			create: vi.fn().mockResolvedValue([]),
			update: vi.fn().mockResolvedValue(undefined),
		}

		const container = createTestContainer(
			Registration.instance(mockIConcertService, mockConcert),
			Registration.instance(mockIFollowServiceClient, mockFollow),
			Registration.instance(mockITicketEmailService, mockTicketEmail),
		)
		container.register(ImportTicketEmailRoute)
		sut = container.get(ImportTicketEmailRoute)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('loading', () => {
		it('sets validation error when email body does not match ticket regex', async () => {
			await sut.loading({}, makeNext({ title: 'Hello', text: 'PlainGreeting' }))

			expect(sut.step).toBe('validation')
			expect(sut.error).toContain('認識できませんでした')
		})

		it('advances to artist step when email body matches ticket regex', async () => {
			await sut.loading({}, makeNext({ title: 'Test', text: 'チケット当選' }))

			expect(sut.step).toBe('artist')
		})

		it('auto-matches artist when name appears in email body', async () => {
			mockFollow.listFollowed.mockResolvedValue([
				{ artist: { id: 'a1', name: 'ArtistXYZ' } },
			])

			await sut.loading(
				{},
				makeNext({ title: 'Test', text: 'チケット ArtistXYZ 当選' }),
			)

			expect(sut.matchedArtistId).toBe('a1')
			expect(sut.selectedArtistId).toBe('a1')
		})
	})

	describe('selectArtist', () => {
		it('loads concerts and advances to concert step', async () => {
			sut.selectedArtistId = 'a1'
			const concerts = [{ id: 'c1' }]
			mockConcert.listConcerts.mockResolvedValue(concerts)

			await sut.selectArtist()

			expect(mockConcert.listConcerts).toHaveBeenCalledWith('a1', undefined)
			expect(sut.concerts).toEqual(concerts)
			expect(sut.step).toBe('concert')
		})

		it('does nothing without selected artist', async () => {
			sut.selectedArtistId = ''
			await sut.selectArtist()
			expect(mockConcert.listConcerts).not.toHaveBeenCalled()
		})
	})

	describe('wizard flow', () => {
		it('confirmConcerts advances to body step', () => {
			sut.confirmConcerts()
			expect(sut.step).toBe('body')
		})

		it('toggleEditBody toggles editing state', () => {
			expect(sut.isEditingBody).toBe(false)
			sut.toggleEditBody()
			expect(sut.isEditingBody).toBe(true)
			sut.toggleEditBody()
			expect(sut.isEditingBody).toBe(false)
		})

		it('hasSelectedConcerts reflects selection', () => {
			expect(sut.hasSelectedConcerts).toBe(false)
			sut.selectedEventIds = ['c1']
			expect(sut.hasSelectedConcerts).toBe(true)
		})
	})

	describe('submitForParsing', () => {
		it('creates emails and advances to confirm step', async () => {
			const emails = [{ id: { value: 'em1' } }]
			mockTicketEmail.create.mockResolvedValue(emails)

			await sut.submitForParsing()

			expect(sut.createdEmails).toEqual(emails)
			expect(sut.step).toBe('confirm')
		})

		it('sets error and returns to body step on failure', async () => {
			mockTicketEmail.create.mockRejectedValue(new Error('parse error'))

			await sut.submitForParsing()

			expect(sut.step).toBe('body')
			expect(sut.error).toContain('解析に失敗')
		})
	})

	describe('sanitizeUrl', () => {
		it('accepts https URLs', () => {
			expect(sut.sanitizeUrl('https://example.com')).toBe('https://example.com')
		})

		it('rejects javascript: URLs', () => {
			const jsUrl = `${'javascript'}:alert(1)`
			expect(sut.sanitizeUrl(jsUrl)).toBe('')
		})

		it('returns empty for undefined', () => {
			expect(sut.sanitizeUrl(undefined)).toBe('')
		})
	})

	describe('formatJourneyStatus', () => {
		it('formats known statuses', () => {
			expect(sut.formatJourneyStatus(1)).toBe('申し込み済')
			expect(sut.formatJourneyStatus(4)).toBe('支払済')
		})

		it('returns unknown for unrecognized status', () => {
			expect(sut.formatJourneyStatus(99 as never)).toBe('不明')
		})
	})

	describe('detaching', () => {
		it('aborts active request', async () => {
			await sut.loading({}, makeNext({ title: 'T', text: 'チケット' }))
			const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

			sut.detaching()

			expect(abortSpy).toHaveBeenCalled()
			abortSpy.mockRestore()
		})
	})
})
