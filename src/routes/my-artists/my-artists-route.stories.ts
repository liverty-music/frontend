import { IRouter } from '@aurelia/router'
import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement, Registration } from 'aurelia'
import { expect, userEvent, waitFor } from 'storybook/test'
import { expectAriaTree } from '../../../.storybook/aria'
import { capturePixels, expectScreenshot } from '../../../.storybook/screenshot'
import { expectTargets } from '../../../.storybook/target-size'
import { PageHelp } from '../../components/page-help/page-help'
import { SignupPromptBanner } from '../../components/signup-prompt-banner/signup-prompt-banner'
import { StatePlaceholder } from '../../components/state-placeholder/state-placeholder'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import type { FollowedArtist, Hype } from '../../entities/follow'
import { IAuthService } from '../../services/auth-service'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import {
	type FabAction,
	IFabMenuService,
} from '../../services/fab-menu-service'
import { IFollowStore } from '../../services/follow-store'
import { IOnboardingService } from '../../services/onboarding-service'
import { IPushOfferService } from '../../services/push-offer-service'
import { IUserStore } from '../../services/user-store'
import { MyArtistsRoute } from './my-artists-route'

// A route story: every store and service the route resolves is a fake
// registered through `items`, so nothing reaches the network (AGENTS.md,
// "Route stories"). It renders the route's own layout, the scroll container
// and what sits above what, which no component story shows.

/**
 * Hype levels without a looping animation (Nearby and Away pulse), so a
 * screenshot of the list is deterministic.
 */
const STILL_HYPES: Hype[] = ['watch', 'home']

function follows(count: number): FollowedArtist[] {
	return Array.from({ length: count }, (_, i) => ({
		artist: { id: `artist-${i + 1}`, name: `Artist ${i + 1}`, mbid: '' },
		hype: STILL_HYPES[i % STILL_HYPES.length],
	}))
}

/** The launcher's actions the route registered last, so a story can invoke them. */
const fab = { actions: [] as FabAction[] }

function items(count: number) {
	return [
		Registration.instance(IFollowStore, {
			listFollowed: async () => follows(count),
			unfollow: async () => {},
			setHype: async () => {},
		}),
		Registration.instance(IAuthService, { isAuthenticated: true }),
		Registration.instance(IOnboardingService, { isOnboarding: false }),
		Registration.instance(IUserStore, {
			needsHome: false,
			currentHome: 'JP-13',
			saveHome: async () => {},
		}),
		Registration.instance(IFabMenuService, {
			register: (_owner: object, actions: FabAction[]) => {
				fab.actions = actions
				return () => {}
			},
			hide: () => () => {},
		}),
		Registration.instance(IPushOfferService, {
			pushState: async () => 'on',
		}),
		Registration.instance(IErrorBoundaryService, {}),
		Registration.instance(IRouter, { load: async () => true }),
	]
}

const register = [
	MyArtistsRoute,
	PageHelp,
	StatePlaceholder,
	UserHomeSelector,
	SignupPromptBanner,
]

/** The route in a frame of the given size, as a phone screen would hold it. */
function frame(width: number, height: number): string {
	return `<div data-frame style="display: grid; inline-size: ${width}px; block-size: ${height}px">
		<my-artists-route></my-artists-route>
	</div>`
}

const meta = {
	title: 'Routes/MyArtists',
	component: MyArtistsRoute,
	parameters: {
		// The help sheet and the home sheet stay closed; the sheets have their
		// own stories.
		a11y: {
			config: {
				// The list body is a scroll container whose rows hold the radio
				// inputs, so it is reachable by keyboard; axe cannot see that
				// through the visually hidden inputs.
				rules: [{ id: 'scrollable-region-focusable', enabled: false }],
			},
		},
	},
} satisfies Meta<typeof MyArtistsRoute>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Runs the router's `loading` hook on every route in the canvas (no router
 * runs here) and waits for `count` rows in total.
 */
async function rendered(canvasElement: HTMLElement, count: number) {
	for (const host of canvasElement.querySelectorAll('my-artists-route')) {
		await CustomElement.for<MyArtistsRoute>(host).viewModel.loading()
	}
	return waitFor(() => {
		const rows = canvasElement.querySelectorAll('.artist-row')
		if (rows.length !== count) throw new Error('rows not rendered yet')
		const thead = canvasElement.querySelector<HTMLElement>('thead')
		const tbody = canvasElement.querySelector<HTMLElement>('tbody')
		if (!thead || !tbody) throw new Error('no table')
		return { thead, tbody, rows: [...rows] as HTMLElement[] }
	})
}

function centerX(el: Element): number {
	const r = el.getBoundingClientRect()
	return r.left + r.width / 2
}

/** Asserts each header label's center is within 1 px of its dots' centers. */
async function expectDotsUnderLabels(scope: Element): Promise<void> {
	const headers = [...scope.querySelectorAll('.hype-col-header')]
	await expect(headers).toHaveLength(4)
	for (const row of [...scope.querySelectorAll('.artist-row')].slice(0, 3)) {
		const dots = [...row.querySelectorAll('.hype-dot')]
		await expect(dots).toHaveLength(4)
		for (const [i, dot] of dots.entries()) {
			await expect(
				Math.abs(centerX(dot) - centerX(headers[i])),
			).toBeLessThanOrEqual(1)
		}
	}
}

/**
 * Points inside a box, inset by 1 px: its corners, its edge midpoints and its
 * center.
 */
function pointsIn(rect: DOMRect): Array<[number, number]> {
	const xs = [rect.left + 1, rect.left + rect.width / 2, rect.right - 1]
	const ys = [rect.top + 1, rect.top + rect.height / 2, rect.bottom - 1]
	return xs.flatMap((x) => ys.map((y): [number, number] => [x, y]))
}

/**
 * Asserts nothing is drawn over any header label: at every sampled point of
 * each label, the topmost element is that label's own header cell.
 */
async function expectLabelsUncovered(thead: HTMLElement): Promise<void> {
	const doc = thead.ownerDocument
	for (const cell of thead.querySelectorAll<HTMLElement>('.hype-col-header')) {
		for (const part of cell.querySelectorAll<HTMLElement>('small')) {
			for (const [x, y] of pointsIn(part.getBoundingClientRect())) {
				const hit = doc.elementFromPoint(x, y)
				await expect(cell.contains(hit)).toBe(true)
			}
		}
	}
}

/** A signed-in fan with 40 followed artists, on a 375 × 600 px screen. */
export const FortyArtists = {
	render: () =>
		defineAureliaStory({
			template: frame(375, 600),
			register,
			items: items(40),
		}),
	play: async ({ canvasElement }) => {
		const { thead, tbody } = await rendered(canvasElement, 40)
		const table = canvasElement.querySelector<HTMLElement>('table')
		if (!table) throw new Error('no table')

		// @spec components/infrastructure/fan/web/route/my-artists "Header renders with 4 columns"
		const labels = [...thead.querySelectorAll('.hype-col-header')].map((th) =>
			th.textContent?.replace(/\s+/g, ''),
		)
		await expect(labels).toEqual([
			'👀Watch',
			'🔥Home',
			'🔥🔥Nearby',
			'🔥🔥🔥Away',
		])
		const widths = [...thead.querySelectorAll('.hype-col-header')].map(
			(th) => th.getBoundingClientRect().width,
		)
		await expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1)

		// @spec components/infrastructure/fan/web/route/my-artists "Header column alignment matches artist row dot positions"
		await expectDotsUnderLabels(canvasElement)

		// @spec components/infrastructure/fan/web/route/my-artists "Table semantics are kept"
		await expectAriaTree(
			table,
			`
			- table:
			  - rowgroup:
			    - row:
			      - columnheader "👀 Watch"
			      - columnheader "🔥 Home"
			      - columnheader "🔥🔥 Nearby"
			      - columnheader "🔥🔥🔥 Away"
			  - rowgroup:
			    - row:
			      - rowheader "Artist 1"
			      - cell
			      - cell
			      - cell
			      - cell
			`,
		)

		// @spec components/infrastructure/fan/web/route/my-artists "Header remains visible during scroll"
		const before = thead.getBoundingClientRect()
		tbody.scrollTop = 300
		await waitFor(() => expect(tbody.scrollTop).toBe(300))
		await new Promise(requestAnimationFrame)
		const after = thead.getBoundingClientRect()
		await expect(after.top).toBe(before.top)
		await expect(after.left).toBe(before.left)
		await expectLabelsUncovered(thead)
		await expect(thead.hasAttribute('data-hype-header')).toBe(true)
		await expectScreenshot(table, 'my-artists-scrolled')
	},
} satisfies Story

/**
 * The fan removes an artist in edit mode while the list is scrolled: the
 * removed row's exit animation stays inside the list.
 */
export const RemoveWhileScrolled = {
	render: () =>
		defineAureliaStory({
			template: frame(375, 600),
			register,
			items: items(40),
		}),
	play: async ({ canvasElement }) => {
		const { thead, tbody } = await rendered(canvasElement, 40)
		const edit = fab.actions.find((a) => a.id === 'edit')
		if (edit?.kind !== 'command') throw new Error('no edit action')
		edit.invoke()
		await waitFor(() =>
			expect(canvasElement.querySelector('.artist-remove-btn')).not.toBeNull(),
		)
		tbody.scrollTop = 300
		await waitFor(() => expect(tbody.scrollTop).toBe(300))

		// The first row whose top is inside the scrolled list.
		const listTop = tbody.getBoundingClientRect().top
		const row = [
			...canvasElement.querySelectorAll<HTMLElement>('.artist-row'),
		].find((r) => r.getBoundingClientRect().top >= listTop)
		const remove = row?.querySelector<HTMLElement>('.artist-remove-btn')
		if (!remove) throw new Error('no visible row')
		// The header ends where the list begins; the capture stops 1 px short
		// so that it holds only the header.
		const headerOnly = { blockEndInset: 1 }
		const before = await capturePixels(thead, headerOnly)
		await userEvent.click(remove)

		// @spec components/infrastructure/fan/web/route/my-artists "Header stays clear while a row animates out"
		// The view transition's snapshots are drawn above the page, where a hit
		// test cannot see them. Hold the transition at its first frame and
		// compare the header's pixels with those before the removal.
		const animations = await waitFor(() => {
			const found = document
				.getAnimations()
				.filter((a) =>
					(a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
						'::view-transition',
					),
				)
			if (found.length === 0) throw new Error('no view transition yet')
			return found
		})
		for (const a of animations) {
			a.pause()
			a.currentTime = 0
		}
		const during = await capturePixels(thead, headerOnly)
		for (const a of animations) a.finish()
		await expect(during).toBe(before)
		await expectLabelsUncovered(thead)
	},
} satisfies Story

/**
 * The header columns over the dots on a 320, a 375 and a 768 px wide screen.
 */
export const Widths = {
	parameters: {
		a11y: {
			config: {
				// Three routes side by side give three `main` landmarks; one
				// screen has one.
				rules: [
					{ id: 'scrollable-region-focusable', enabled: false },
					{ id: 'landmark-no-duplicate-main', enabled: false },
					{ id: 'landmark-unique', enabled: false },
				],
			},
		},
	},
	render: () =>
		defineAureliaStory({
			template: [320, 375, 768].map((w) => frame(w, 400)).join(''),
			register,
			items: items(5),
		}),
	play: async ({ canvasElement }) => {
		await rendered(canvasElement, 15)
		// @spec components/infrastructure/fan/web/route/my-artists "Slider spans header dot columns"
		for (const route of canvasElement.querySelectorAll('my-artists-route')) {
			await expectDotsUnderLabels(route)
		}
		// At 320 px the four dots still take a 48 px tap each, side by side
		// without overlap, and the artist name keeps room to be read.
		const narrow = canvasElement.querySelector('my-artists-route')
		if (!narrow) throw new Error('no route rendered')
		const firstRow = narrow.querySelector<HTMLElement>(
			'[data-artist-rows] .artist-row',
		)
		if (!firstRow) throw new Error('no artist row rendered')
		// @spec components/infrastructure/fan/web/route/my-artists "Slider renders on each artist row"
		// @spec components/infrastructure/fan/web/global/design-tokens "Neighbouring controls"
		expectTargets(firstRow, '.hype-label')
		// The room left for the name's text in its cell (the cell less its
		// start padding, the colour dot and the gap): four full-width characters
		// at 16 px, so a name like ヨルシカ shows whole.
		// The name column fits its content, so measure with a long name.
		const longName = firstRow.querySelector('.artist-row-name')
		if (!longName) throw new Error('no artist name rendered')
		longName.textContent = 'Official髭男dism'
		await new Promise(requestAnimationFrame)
		const cell = firstRow.querySelector<HTMLElement>('.artist-name-cell')
		const dot = firstRow.querySelector<HTMLElement>('.artist-row-indicator')
		if (!cell || !dot) throw new Error('no artist name cell rendered')
		const style = getComputedStyle(cell)
		const room =
			cell.getBoundingClientRect().width -
			Number.parseFloat(style.paddingInlineStart) -
			Number.parseFloat(style.paddingInlineEnd) -
			dot.getBoundingClientRect().width -
			Number.parseFloat(style.columnGap)
		await expect(room).toBeGreaterThanOrEqual(64)
	},
} satisfies Story
