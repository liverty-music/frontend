import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeAuth = { isAuthenticated: true }
const fakeGuide = { replay: vi.fn() }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: { friendlyName?: string }) =>
			token.friendlyName === 'IGuideService' ? fakeGuide : fakeAuth,
		),
		bindable: actual.bindable,
	}
})

import { PageHelp, type PageHelpPage } from './page-help'

const SPEC = 'components/infrastructure/fan/web/global/page-help'

describe('PageHelp', () => {
	let sut: PageHelp

	beforeEach(() => {
		fakeAuth.isAuthenticated = true
		fakeGuide.replay.mockClear()
		sut = new PageHelp()
	})

	describe('opening', () => {
		it(`@spec ${SPEC} "Help never opens on its own"`, () => {
			// No lifecycle opens it: only the action launcher's help item does.
			for (const page of ['discovery', 'my-artists', 'timetable'] as const) {
				const help = new PageHelp()
				help.page = page
				expect(help.isOpen).toBe(false)
				expect('attached' in help).toBe(false)
				help.open()
				expect(help.isOpen).toBe(true)
			}
		})

		it('closes the sheet', () => {
			sut.isOpen = true
			sut.onSheetClosed()
			expect(sut.isOpen).toBe(false)
		})
	})

	describe('「チュートリアル」', () => {
		it(`@spec ${SPEC} "Replay from Discovery help"`, () => {
			sut.page = 'discovery'
			sut.view = 'artists'
			sut.open()

			expect(sut.findingReplay).toBe('discovery.follow')
			sut.replay('discovery.follow')

			expect(sut.isOpen).toBe(false)
			expect(fakeGuide.replay).toHaveBeenCalledWith('discovery.follow')
		})

		it('offers the bubble field moment only while the bubbles are shown', () => {
			sut.view = 'concerts'
			expect(sut.findingReplay).toBeNull()
		})

		it("replays the swap tile's moment on the bubbles and the filter's on the Concerts view", () => {
			sut.view = 'artists'
			expect(sut.concertsReplay).toBe('discovery.swap')
			sut.view = 'concerts'
			expect(sut.concertsReplay).toBe('concerts.filter')
		})

		it(`@spec components/infrastructure/fan/web/global/guide-moment "Replay the hype moment"`, () => {
			sut.page = 'my-artists'
			sut.hasArtists = true
			sut.open()

			sut.replay(sut.hypeReplay ?? 'myArtists.hype')

			expect(sut.isOpen).toBe(false)
			expect(fakeGuide.replay).toHaveBeenCalledWith('myArtists.hype')
		})

		it('offers no hype replay without a followed artist', () => {
			sut.hasArtists = false
			expect(sut.hypeReplay).toBeNull()
		})
	})

	describe('page bindable', () => {
		it('defaults to discovery', () => {
			expect(sut.page).toBe('discovery')
		})

		it('accepts all valid page values', () => {
			const pages: PageHelpPage[] = ['discovery', 'timetable', 'my-artists']
			for (const page of pages) {
				sut.page = page
				expect(sut.page).toBe(page)
			}
		})
	})
})
