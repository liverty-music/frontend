import { IRouter } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'

const mockIConsentService = DI.createInterface('IConsentService')
const mockIOnboardingService = DI.createInterface('IOnboardingService')

vi.mock('../../src/lib/consent/consent-service', () => ({
	IConsentService: mockIConsentService,
}))

vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
}))

const { ConsentRoute } = await import('../../src/routes/consent/consent-route')

describe('ConsentRoute', () => {
	let sut: InstanceType<typeof ConsentRoute>
	let mockConsent: {
		analytics: boolean
		marketingMeasurement: boolean
		grant: ReturnType<typeof vi.fn>
		revoke: ReturnType<typeof vi.fn>
		defer: ReturnType<typeof vi.fn>
	}
	let mockOnboarding: { finish: ReturnType<typeof vi.fn> }
	let mockRouter: ReturnType<typeof createMockRouter>

	beforeEach(() => {
		mockConsent = {
			analytics: false,
			marketingMeasurement: false,
			grant: vi.fn(),
			revoke: vi.fn(),
			defer: vi.fn(),
		}
		mockOnboarding = { finish: vi.fn() }
		mockRouter = createMockRouter()

		const container = createTestContainer(
			Registration.instance(mockIConsentService, mockConsent),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(IRouter, mockRouter),
		)
		container.register(ConsentRoute)
		sut = container.get(ConsentRoute)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('hydrates toggle state from live consent on attached', () => {
		mockConsent.analytics = true
		mockConsent.marketingMeasurement = false
		sut.attached()

		expect(sut.analyticsConsent).toBe(true)
		expect(sut.marketingConsent).toBe(false)
	})

	it('toggles flip the local draft fields', () => {
		sut.toggleAnalytics()
		sut.toggleMarketing()
		expect(sut.analyticsConsent).toBe(true)
		expect(sut.marketingConsent).toBe(true)

		sut.toggleAnalytics()
		expect(sut.analyticsConsent).toBe(false)
	})

	it('acceptSelected grants/revokes per draft, finishes onboarding, routes to dashboard', async () => {
		sut.analyticsConsent = true
		sut.marketingConsent = false
		await sut.acceptSelected()

		expect(mockConsent.grant).toHaveBeenCalledWith('analytics')
		expect(mockConsent.revoke).toHaveBeenCalledWith('marketingMeasurement')
		expect(mockOnboarding.finish).toHaveBeenCalledOnce()
		expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
	})

	it('declineAll revokes both purposes, finishes onboarding, routes to dashboard', async () => {
		await sut.declineAll()

		expect(mockConsent.revoke).toHaveBeenCalledWith('analytics')
		expect(mockConsent.revoke).toHaveBeenCalledWith('marketingMeasurement')
		expect(mockOnboarding.finish).toHaveBeenCalledOnce()
		expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
	})

	it('setUpLater defers, finishes onboarding, routes to dashboard', async () => {
		await sut.setUpLater()

		expect(mockConsent.defer).toHaveBeenCalledOnce()
		expect(mockOnboarding.finish).toHaveBeenCalledOnce()
		expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
	})
})
