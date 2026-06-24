import { IRouter } from '@aurelia/router'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'

const { ConsentRoute } = await import('../../src/routes/consent/consent-route')

const NOTICE_SEEN_KEY = 'liverty:analytics:noticeSeen'

describe('ConsentRoute (transparency notice)', () => {
	let sut: InstanceType<typeof ConsentRoute>
	let mockRouter: ReturnType<typeof createMockRouter>

	beforeEach(() => {
		localStorage.clear()
		mockRouter = createMockRouter()

		const container = createTestContainer(
			Registration.instance(IRouter, mockRouter),
		)
		container.register(ConsentRoute)
		sut = container.get(ConsentRoute)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		localStorage.clear()
	})

	it('acknowledge records the seen flag and routes to dashboard WITHOUT touching consent state', async () => {
		// The route no longer resolves IConsentService at all — acknowledging
		// the notice must never mutate the default-on opt-out posture. The
		// absence of any ConsentService dependency is the structural guarantee
		// that the notice cannot gate or change consent.
		await sut.acknowledge()

		expect(localStorage.getItem(NOTICE_SEEN_KEY)).toBe('1')
		expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
	})

	it('acknowledge tolerates a storage failure and still routes to dashboard', async () => {
		const setItem = vi
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(() => {
				throw new DOMException('quota', 'SecurityError')
			})

		await sut.acknowledge()

		// Storage failure is non-fatal: onboarding/navigation must proceed.
		expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
		setItem.mockRestore()
	})

	it('openSettings routes to the settings opt-out controls', async () => {
		await sut.openSettings()

		expect(mockRouter.load).toHaveBeenCalledWith('/settings')
	})
})
