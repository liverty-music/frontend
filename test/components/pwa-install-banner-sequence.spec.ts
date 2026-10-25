import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The banner driven by the real PwaInstallService, so the whole install from
// the banner is one sequence of usage events: the banner and the service each
// send their part.

const fakeLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	scopeTo: vi.fn(),
}
fakeLogger.scopeTo.mockReturnValue(fakeLogger)
const fakeAnalytics = { capture: vi.fn() }
const fakeElement = document.createElement('pwa-install-banner')
const fakeRouterEvents = {
	subscribe: vi.fn(() => ({ dispose: vi.fn() })),
}
let installService: unknown = null

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const name = String(token)
			if (name.includes('Logger')) return fakeLogger
			if (name.includes('Onboarding')) return { isCompleted: true }
			if (name.includes('Analytics')) return fakeAnalytics
			if (name.includes('PwaInstall')) return installService
			if (name.includes('RouterEvents')) return fakeRouterEvents
			if (name.includes('INode') || name.includes('Node')) return fakeElement
			return {}
		}),
		watch: () => () => {},
	}
})

import { PwaInstallBanner } from '../../src/components/pwa-install-banner/pwa-install-banner'
import { Events } from '../../src/lib/analytics/analytics-service'
import { PwaInstallService } from '../../src/services/pwa-install-service'

function installRequest() {
	const event = new Event('beforeinstallprompt') as Event & {
		prompt: ReturnType<typeof vi.fn>
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
	}
	event.preventDefault = vi.fn()
	event.prompt = vi.fn().mockResolvedValue(undefined)
	event.userChoice = Promise.resolve({ outcome: 'accepted' as const })
	return event
}

describe('installing from the banner', () => {
	beforeEach(() => {
		localStorage.clear()
		fakeAnalytics.capture.mockClear()
		// A browser that offers the install request.
		Object.defineProperty(window, 'BeforeInstallPromptEvent', {
			value: class {},
			configurable: true,
		})
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}))
	})

	afterEach(() => {
		installService = null
		delete (window as unknown as Record<string, unknown>)
			.BeforeInstallPromptEvent
	})

	it('reports the banner shown, the accepted answer and the install', async () => {
		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Install from the banner"
		const service = new PwaInstallService()
		installService = service
		window.dispatchEvent(installRequest())
		const banner = new PwaInstallBanner()
		banner.binding()

		banner.attached()
		await banner.onCta()
		window.dispatchEvent(new Event('appinstalled'))

		expect(fakeAnalytics.capture.mock.calls.map(([name]) => name)).toEqual([
			Events.PwaInstallBannerShown,
			Events.PwaInstallAnswered,
			Events.PwaInstalled,
		])
		expect(fakeAnalytics.capture.mock.calls[1][1]).toEqual({
			answer: 'accepted',
		})
	})
})
