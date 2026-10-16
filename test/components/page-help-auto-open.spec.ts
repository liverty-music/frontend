import { beforeEach, describe, expect, it, vi } from 'vitest'

// The help sheet's first-visit auto-open against the real onboarding storage
// (real localStorage), so the key names the spec states are what is written.
const fakeOnboarding = { isOnboarding: true }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return { ...actual, resolve: vi.fn(() => fakeOnboarding) }
})

const { PageHelp } = await import('../../src/components/page-help/page-help')

const CAPABILITY = 'components/infrastructure/fan/web/global/page-help'

function visit(page: 'discovery' | 'my-artists') {
	const sut = new PageHelp()
	sut.page = page
	sut.attached()
	return sut
}

describe(`${CAPABILITY}: auto-open on first page visit`, () => {
	beforeEach(() => {
		localStorage.clear()
		fakeOnboarding.isOnboarding = true
	})

	it('opens on the first Discovery visit during onboarding and records it', () => {
		// @spec components/infrastructure/fan/web/global/page-help "First visit to Discovery during onboarding"
		expect(localStorage.getItem('onboarding.helpSeen:discovery')).toBeNull()

		const sut = visit('discovery')

		expect(sut.isOpen).toBe(true)
		expect(localStorage.getItem('onboarding.helpSeen:discovery')).toBe('1')
	})

	it('opens on the first My Artists visit during onboarding and records it', () => {
		// @spec components/infrastructure/fan/web/global/page-help "First visit to My Artists during onboarding"
		expect(localStorage.getItem('onboarding.helpSeen:my-artists')).toBeNull()

		const sut = visit('my-artists')

		expect(sut.isOpen).toBe(true)
		expect(localStorage.getItem('onboarding.helpSeen:my-artists')).toBe('1')
	})

	it('does not open again once the page is recorded, but opens on the ? tap', () => {
		// @spec components/infrastructure/fan/web/global/page-help "Subsequent visits do not auto-open"
		for (const page of ['discovery', 'my-artists'] as const) {
			localStorage.setItem(`onboarding.helpSeen:${page}`, '1')

			const sut = visit(page)

			expect(sut.isOpen).toBe(false)
			sut.open()
			expect(sut.isOpen).toBe(true)
		}
	})
})
