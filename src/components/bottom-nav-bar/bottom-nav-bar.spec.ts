import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockCurrentPath = ''

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		// Both IRouter and IRouterEvents resolve to this shape: `routeTree` for
		// the current-path read, `subscribe` for the navigation-end listener.
		resolve: vi.fn(() => ({
			routeTree: {
				root: {
					children: [{ computeAbsolutePath: () => mockCurrentPath }],
				},
			},
			subscribe: vi.fn(() => ({ dispose: vi.fn() })),
		})),
	}
})

import { BottomNavBar } from './bottom-nav-bar'

describe('BottomNavBar', () => {
	let sut: BottomNavBar

	beforeEach(() => {
		mockCurrentPath = ''
		sut = new BottomNavBar()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('tabs', () => {
		it('has 4 navigation tabs', () => {
			expect(sut.tabs).toHaveLength(4)
		})

		it('includes dashboard, discovery, my-artists, settings', () => {
			const paths = sut.tabs.map((t) => t.path)
			expect(paths).toEqual([
				'dashboard',
				'discovery',
				'my-artists',
				'settings',
			])
		})
	})

	// `activeTab` is recomputed on `binding()` (and on each navigation-end); the
	// template binds `data-active="tab.path === activeTab"`.
	describe('activeTab', () => {
		it('is the exact-matching tab path', () => {
			mockCurrentPath = 'dashboard'
			sut.binding()
			expect(sut.activeTab).toBe('dashboard')
		})

		it('reflects a different active route', () => {
			mockCurrentPath = 'settings'
			sut.binding()
			expect(sut.activeTab).toBe('settings')
		})

		it('resolves dashboard for a concerts/ sub-path', () => {
			mockCurrentPath = 'concerts/abc-123'
			sut.binding()
			expect(sut.activeTab).toBe('dashboard')
		})

		it('resolves the owning tab for a sub-path', () => {
			mockCurrentPath = 'my-artists/detail'
			sut.binding()
			expect(sut.activeTab).toBe('my-artists')
		})

		it('is empty when no tab matches the current path', () => {
			mockCurrentPath = ''
			sut.binding()
			expect(sut.activeTab).toBe('')
		})

		it('updates when navigation changes the current path', () => {
			mockCurrentPath = 'dashboard'
			sut.binding()
			expect(sut.activeTab).toBe('dashboard')

			// Simulate a navigation to another tab, then the navigation-end
			// recompute (invoked here directly via binding()).
			mockCurrentPath = 'discovery'
			sut.binding()
			expect(sut.activeTab).toBe('discovery')
		})
	})
})
