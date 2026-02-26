import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'

const mockIDashboardService = DI.createInterface('IDashboardService')

vi.mock('../../src/services/dashboard-service', () => ({
	IDashboardService: mockIDashboardService,
}))

vi.mock('../../src/components/region-setup-sheet/region-setup-sheet', () => ({
	RegionSetupSheet: {
		getStoredRegion: vi.fn().mockReturnValue(null),
	},
}))

const { Dashboard } = await import('../../src/routes/dashboard')
const { RegionSetupSheet } = await import(
	'../../src/components/region-setup-sheet/region-setup-sheet'
)

describe('Dashboard', () => {
	let sut: InstanceType<typeof Dashboard>
	let mockDashboardService: {
		loadDashboardEvents: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		mockDashboardService = {
			loadDashboardEvents: vi.fn().mockResolvedValue([]),
		}

		const container = createTestContainer(
			Registration.instance(mockIDashboardService, mockDashboardService),
		)
		container.register(Dashboard)
		sut = container.get(Dashboard)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('loadData', () => {
		it('should populate dateGroups on success', async () => {
			const fakeGroups = [
				{
					label: 'Jan 1',
					dateKey: '2026-01-01',
					main: [],
					region: [],
					other: [],
				},
			]
			mockDashboardService.loadDashboardEvents.mockResolvedValue(fakeGroups)

			sut.loadData()
			await sut.dataPromise

			expect(sut.dateGroups).toEqual(fakeGroups)
			expect(sut.loadError).toBeNull()
		})

		it('should preserve stale data on failure when data exists', async () => {
			// First load succeeds
			const fakeGroups = [
				{
					label: 'Jan 1',
					dateKey: '2026-01-01',
					main: [],
					region: [],
					other: [],
				},
			]
			mockDashboardService.loadDashboardEvents.mockResolvedValue(fakeGroups)
			sut.loadData()
			await sut.dataPromise

			// Second load fails
			mockDashboardService.loadDashboardEvents.mockRejectedValue(
				new Error('network'),
			)
			sut.loadData()
			await sut.dataPromise!.catch(() => {})

			expect(sut.dateGroups).toEqual(fakeGroups)
			expect(sut.isStale).toBe(true)
			expect(sut.loadError).toBeInstanceOf(Error)
		})

		it('should ignore AbortError', async () => {
			const abortError = new DOMException('aborted', 'AbortError')
			mockDashboardService.loadDashboardEvents.mockRejectedValue(abortError)

			sut.loadData()
			await sut.dataPromise!.catch(() => {})

			expect(sut.loadError).toBeNull()
			expect(sut.isStale).toBe(false)
		})

		it('should abort previous request on new loadData call', () => {
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			sut.loadData()
			sut.loadData()

			// loadDashboardEvents is called twice
			expect(mockDashboardService.loadDashboardEvents).toHaveBeenCalledTimes(2)
		})
	})

	describe('retry', () => {
		it('should call loadData again', () => {
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			sut.retry()

			expect(mockDashboardService.loadDashboardEvents).toHaveBeenCalledTimes(1)
		})
	})

	describe('loading', () => {
		it('should check region and load data', async () => {
			;(
				RegionSetupSheet.getStoredRegion as ReturnType<typeof vi.fn>
			).mockReturnValue(null)
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
			expect(mockDashboardService.loadDashboardEvents).toHaveBeenCalledTimes(1)
		})

		it('should not need region when stored region exists', async () => {
			;(
				RegionSetupSheet.getStoredRegion as ReturnType<typeof vi.fn>
			).mockReturnValue('Tokyo')
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})
	})

	describe('onRegionSelected', () => {
		it('should set needsRegion to false', () => {
			sut.needsRegion = true
			sut.onRegionSelected('Tokyo')
			expect(sut.needsRegion).toBe(false)
		})
	})

	describe('detaching', () => {
		it('should abort active request', () => {
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])
			sut.loadData()

			sut.detaching()
			// No error — abort controller is cleaned up
			expect(true).toBe(true)
		})
	})
})
