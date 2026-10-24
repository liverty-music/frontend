import { IRouter } from '@aurelia/router'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'

const { ConsentRoute } = await import('../../src/routes/consent/consent-route')

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

	it('acknowledge routes to dashboard WITHOUT touching consent state or storage', async () => {
		// The route no longer resolves IConsentService at all — acknowledging
		// the notice must never mutate the default-on opt-out posture. The
		// absence of any ConsentService dependency is the structural guarantee
		// that the notice cannot gate or change consent.
		const setItem = vi.spyOn(Storage.prototype, 'setItem')

		await sut.acknowledge()

		expect(setItem).not.toHaveBeenCalled()
		expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
	})

	it('openSettings routes to the settings opt-out controls', async () => {
		await sut.openSettings()

		expect(mockRouter.load).toHaveBeenCalledWith('/settings')
	})
})
