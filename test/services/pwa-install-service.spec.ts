import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	IPwaInstallService,
	PwaInstallService,
} from '../../src/services/pwa-install-service'

describe('PwaInstallService', () => {
	let sut: PwaInstallService
	let container: ReturnType<typeof DI.createContainer>
	let addEventListenerSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		localStorage.clear()
		addEventListenerSpy = vi.spyOn(window, 'addEventListener')

		container = DI.createContainer()
		container.register(
			Registration.instance(
				ILogger,
				Object.assign(
					{
						debug: vi.fn(),
						info: vi.fn(),
						warn: vi.fn(),
						error: vi.fn(),
						scopeTo: vi.fn().mockReturnThis(),
					},
					{ [Symbol.for('au:resource:resolver')]: undefined },
				),
			),
		)
		container.register(PwaInstallService)
		sut = container.get(IPwaInstallService)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should increment session count on construction', () => {
		expect(localStorage.getItem('pwa.sessionCount')).toBe('1')
	})

	it('should accumulate session count across instances', () => {
		localStorage.setItem('pwa.sessionCount', '5')
		const container2 = DI.createContainer()
		container2.register(
			Registration.instance(
				ILogger,
				Object.assign(
					{
						debug: vi.fn(),
						info: vi.fn(),
						warn: vi.fn(),
						error: vi.fn(),
						scopeTo: vi.fn().mockReturnThis(),
					},
					{ [Symbol.for('au:resource:resolver')]: undefined },
				),
			),
		)
		container2.register(PwaInstallService)
		container2.get(IPwaInstallService)
		expect(localStorage.getItem('pwa.sessionCount')).toBe('6')
	})

	it('should register beforeinstallprompt listener', () => {
		expect(addEventListenerSpy).toHaveBeenCalledWith(
			'beforeinstallprompt',
			expect.any(Function),
		)
	})

	it('should not show prompt on first session', () => {
		expect(sut.canShow).toBe(false)
	})

	it('should show prompt when session >= 2 and event fires', () => {
		localStorage.setItem('pwa.sessionCount', '2')

		const call = addEventListenerSpy.mock.calls.find(
			(c) => c[0] === 'beforeinstallprompt',
		)
		const handler = call![1] as (e: Event) => void

		const fakeEvent = {
			preventDefault: vi.fn(),
			prompt: vi.fn().mockResolvedValue(undefined),
			userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
		}
		handler(fakeEvent as unknown as Event)

		expect(fakeEvent.preventDefault).toHaveBeenCalled()
		expect(sut.canShow).toBe(true)
	})

	it('should not show prompt when dismissed', () => {
		localStorage.setItem('pwa.sessionCount', '2')
		localStorage.setItem('pwa.installPromptDismissed', 'true')

		const call = addEventListenerSpy.mock.calls.find(
			(c) => c[0] === 'beforeinstallprompt',
		)
		const handler = call![1] as (e: Event) => void

		handler({
			preventDefault: vi.fn(),
			prompt: vi.fn(),
			userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
		} as unknown as Event)

		expect(sut.canShow).toBe(false)
	})

	it('should call prompt on install()', async () => {
		localStorage.setItem('pwa.sessionCount', '2')

		const call = addEventListenerSpy.mock.calls.find(
			(c) => c[0] === 'beforeinstallprompt',
		)
		const handler = call![1] as (e: Event) => void

		const fakeEvent = {
			preventDefault: vi.fn(),
			prompt: vi.fn().mockResolvedValue(undefined),
			userChoice: Promise.resolve({ outcome: 'accepted' as const }),
		}
		handler(fakeEvent as unknown as Event)

		await sut.install()

		expect(fakeEvent.prompt).toHaveBeenCalled()
		expect(sut.canShow).toBe(false)
	})

	it('should do nothing if install() called without deferred prompt', async () => {
		await sut.install()
		expect(sut.canShow).toBe(false)
	})

	it('should persist dismissal and hide banner', () => {
		sut.dismiss()

		expect(localStorage.getItem('pwa.installPromptDismissed')).toBe(
			'true',
		)
		expect(sut.canShow).toBe(false)
	})
})
