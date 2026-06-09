import { DI, ILogger, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	IOnboardingService,
	type OnboardingService,
} from '../../src/services/onboarding-service'
import { createMockLogger } from '../helpers/mock-logger'

/**
 * Reactivity guard (task 7.7): the backing `onboardingComplete` field MUST be
 * `@observable` so the derived `isCompleted` / `isOnboarding` getters notify
 * dependent bindings/watchers (`pwa-install-service` `@watch(isCompleted)`, the
 * `app-shell.html` `if.bind`). A plain field would leave those stale on
 * `finish()`.
 *
 * Aurelia's `@observable` decorator wires change notification through the
 * convention-named `[prop]Changed` callback. Asserting that callback fires on
 * `finish()` (with the new/old values) confirms the decorator is in place and
 * the observation machinery a watcher subscribes to is live.
 */
describe('OnboardingService reactivity', () => {
	let sut: OnboardingService

	beforeEach(() => {
		localStorage.clear()
		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		container.register(IOnboardingService)
		sut = container.get(IOnboardingService) as OnboardingService
	})

	it('fires the @observable change callback (and flips the getters) when finish() latches', () => {
		const spy = vi.spyOn(sut, 'onboardingCompleteChanged')

		expect(sut.isCompleted).toBe(false)
		expect(sut.isOnboarding).toBe(true)

		sut.finish()

		expect(spy).toHaveBeenCalledWith(true, false)
		expect(sut.isCompleted).toBe(true)
		expect(sut.isOnboarding).toBe(false)
	})

	it('does not re-fire the change callback on an idempotent second finish()', () => {
		sut.finish()
		const spy = vi.spyOn(sut, 'onboardingCompleteChanged')

		sut.finish()

		expect(spy).not.toHaveBeenCalled()
	})
})
