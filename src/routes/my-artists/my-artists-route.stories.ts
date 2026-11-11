import { IRouter } from '@aurelia/router'
import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement, Registration } from 'aurelia'
import { expect, userEvent, waitFor } from 'storybook/test'
import { expectAriaTree } from '../../../.storybook/aria'
import { resolveColor } from '../../../.storybook/contrast'
import { capturePixels, expectScreenshot } from '../../../.storybook/screenshot'
import { expectTargets } from '../../../.storybook/target-size'
import { artistColor } from '../../adapter/view/artist-color'
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

function follows(count: number, hypes: Hype[] = STILL_HYPES): FollowedArtist[] {
	return Array.from({ length: count }, (_, i) => ({
		artist: { id: `artist-${i + 1}`, name: `Artist ${i + 1}`, mbid: '' },
		hype: hypes[i % hypes.length],
	}))
}

/** The saves the faked follow store received, as `artistId:hype`. */
const saved: string[] = []

/** The launcher's actions the route registered last, so a story can invoke them. */
const fab = { actions: [] as FabAction[] }

function items(
	count: number,
	{
		setHype = async () => {},
		hypes = STILL_HYPES,
	}: {
		setHype?: (artistId: string, hype: Hype) => Promise<void>
		hypes?: Hype[]
	} = {},
) {
	return [
		Registration.instance(IFollowStore, {
			listFollowed: async () => follows(count, hypes),
			unfollow: async () => {},
			setHype,
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
		// The name on the left and the slider on its right, on one row: four
		// stops on a 2 px track, the active dot 14 px and the others 8 px.
		const nameCell = firstRow.querySelector('.artist-name-cell')
		const labels = [...firstRow.querySelectorAll('.hype-label')]
		if (!nameCell) throw new Error('no artist name cell rendered')
		await expect(labels).toHaveLength(4)
		const middle = (el: Element) => {
			const r = el.getBoundingClientRect()
			return r.top + r.height / 2
		}
		for (const label of labels) {
			await expect(
				Math.abs(middle(label) - middle(nameCell)),
			).toBeLessThanOrEqual(1)
			await expect(label.getBoundingClientRect().left).toBeGreaterThanOrEqual(
				nameCell.getBoundingClientRect().right,
			)
		}
		await expect(
			getComputedStyle(firstRow.querySelector('.artist-row-name') as Element)
				.textOverflow,
		).toBe('ellipsis')
		await expect(getComputedStyle(labels[0], '::before').height).toBe('2px')
		await Promise.all(
			document
				.getAnimations()
				.filter((a) => a instanceof CSSTransition)
				.map((a) => a.finished),
		)
		const dots = [...firstRow.querySelectorAll<HTMLElement>('.hype-dot')]
		await expect(dots.filter((d) => d.dataset.active === 'true')).toHaveLength(
			1,
		)
		for (const dot of dots) {
			const size = dot.dataset.active === 'true' ? 14 : 8
			await expect(dot.getBoundingClientRect().width).toBe(size)
			await expect(dot.getBoundingClientRect().height).toBe(size)
		}
		// The room left for the name's text in its cell (the cell less its
		// padding; the row has no colour dot before the name): five full-width
		// characters at 16 px, so a name like ヨルシカ shows whole with room
		// to spare.
		// The name column fits its content, so measure with a long name.
		const longName = firstRow.querySelector('.artist-row-name')
		if (!longName) throw new Error('no artist name rendered')
		longName.textContent = 'Official髭男dism'
		await new Promise(requestAnimationFrame)
		const cell = firstRow.querySelector<HTMLElement>('.artist-name-cell')
		if (!cell) throw new Error('no artist name cell rendered')
		await expect(cell.querySelector('.artist-row-indicator')).toBeNull()
		const style = getComputedStyle(cell)
		const room =
			cell.getBoundingClientRect().width -
			Number.parseFloat(style.paddingInlineStart) -
			Number.parseFloat(style.paddingInlineEnd)
		await expect(room).toBeGreaterThanOrEqual(80)
	},
} satisfies Story

/** The row of artist `id`, and the radio and dot of each of its levels. */
function hypeRow(root: ParentNode, id: string) {
	const row = [...root.querySelectorAll<HTMLElement>('.artist-row')].find((r) =>
		r.querySelector(`input[name="hype-${id}"]`),
	)
	if (!row) throw new Error(`no row for ${id}`)
	const levels = ['watch', 'home', 'nearby', 'away'] as const
	const labels = [...row.querySelectorAll<HTMLElement>('.hype-label')]
	return {
		row,
		radios: labels.map((l) => l.querySelector<HTMLInputElement>('input')),
		dots: labels.map((l) => l.querySelector<HTMLElement>('.hype-dot')),
		labelOf: (level: (typeof levels)[number]) => labels[levels.indexOf(level)],
		/** The level whose dot is the active one. */
		active: () =>
			levels[
				labels.findIndex(
					(l) =>
						l.querySelector<HTMLElement>('.hype-dot')?.dataset.active ===
						'true',
				)
			],
	}
}

/**
 * A fan picks a hype level by tapping a dot of a row. The route accepts the
 * pick (the save succeeds) or reverts it (the save fails twice), and the dot
 * follows.
 */
export const PickingHypeLevels = {
	render: () => {
		saved.length = 0
		return defineAureliaStory({
			template: frame(375, 600),
			register,
			items: items(2, {
				setHype: async (artistId, hype) => {
					saved.push(`${artistId}:${hype}`)
					// artist-2 cannot be saved.
					if (artistId === 'artist-2') {
						// Late enough for the story to see the pick before the revert.
						await new Promise((r) => setTimeout(r, 150))
						throw new Error('save failed')
					}
				},
			}),
		})
	},
	play: async ({ canvasElement }) => {
		await rendered(canvasElement, 2)
		const table = canvasElement.querySelector<HTMLElement>('table')
		if (!table) throw new Error('no table')
		const changes: string[] = []
		table.addEventListener('change', (e) => {
			const input = e.target as HTMLInputElement
			changes.push(`${input.name}:${input.checked}`)
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Native radio input semantics"
		const fieldset = table.closest('fieldset')
		if (!fieldset) throw new Error('the table is not in a fieldset')
		const legend = fieldset.querySelector(':scope > legend')
		await expect(legend?.classList.contains('visually-hidden')).toBe(true)
		const first = hypeRow(canvasElement, 'artist-1')
		for (const label of [...first.row.querySelectorAll('.hype-label')]) {
			await expect(label.localName).toBe('label')
			const radio = label.querySelector<HTMLInputElement>(':scope > input')
			await expect(radio?.type).toBe('radio')
			await expect(radio?.classList.contains('visually-hidden')).toBe(true)
			await expect(radio?.name).toBe('hype-artist-1')
			await expect(label.querySelector(':scope > span.hype-dot')).not.toBeNull()
		}
		// Each radio carries its level as its model, and the radio of the
		// artist's current level is the checked one from the first display on.
		await expect(first.radios.map((r) => r?.checked)).toEqual([
			true,
			false,
			false,
			false,
		])
		await expect(first.active()).toBe('watch')

		// @spec components/infrastructure/fan/web/route/my-artists "User taps a dot"
		// A dot is tapped.
		const picks: Array<{ id: string; level: string }> = []
		table.addEventListener('hype-changed', (e) => {
			const { artist, level } = (
				e as CustomEvent<{ artist: { artist: { id: string } }; level: string }>
			).detail
			picks.push({ id: artist.artist.id, level })
		})
		await userEvent.click(first.labelOf('nearby'))
		// The radio takes the tap natively, and its `change` event crosses the
		// custom element boundary up to the table.
		await expect(first.radios.map((r) => r?.checked)).toEqual([
			false,
			false,
			true,
			false,
		])
		await expect(changes).toEqual(['hype-artist-1:true'])
		// The row tells the page which artist and level, with a bubbling
		// `hype-changed` event, and the page handles it (it saves the pick).
		await expect(picks).toEqual([{ id: 'artist-1', level: 'nearby' }])
		await waitFor(() => expect(saved).toContain('artist-1:nearby'))

		// @spec components/infrastructure/fan/web/route/my-artists "Parent accepts hype selection"
		// The route keeps the pick: the save succeeded, and the dot stays.
		await waitFor(() => expect(saved).toContain('artist-1:nearby'))
		await expect(first.active()).toBe('nearby')
		await new Promise((r) => setTimeout(r, 50))
		await expect(first.active()).toBe('nearby')
		await expect(first.radios[2]?.checked).toBe(true)

		// @spec components/infrastructure/fan/web/route/my-artists "Parent reverts hype selection"
		// The route reverts a pick whose save fails (after its one retry).
		const second = hypeRow(canvasElement, 'artist-2')
		await expect(second.active()).toBe('home')
		changes.length = 0
		await userEvent.click(second.labelOf('away'))
		await expect(second.active()).toBe('away')
		await expect(second.radios.map((r) => r?.checked)).toEqual([
			false,
			false,
			false,
			true,
		])
		await waitFor(() => expect(second.active()).toBe('home'))
		// The previous level's radio is the checked one again, the tapped one
		// is not.
		await expect(second.radios.map((r) => r?.checked)).toEqual([
			false,
			true,
			false,
			false,
		])
		// The revert is a programmatic update: no second `change` event.
		await new Promise((r) => setTimeout(r, 50))
		await expect(changes).toEqual(['hype-artist-2:true'])
		await expect(saved.filter((s) => s.startsWith('artist-2:'))).toEqual([
			'artist-2:away',
			'artist-2:away',
		])
	},
} satisfies Story

/**
 * The active dot's pulse follows the system preference. The story runs in
 * both Storybook projects (see MotionFollowsSystemPreference in the
 * ConcertHighway stories) and asserts the presentation of the one in use.
 */
export const HypeDotMotionFollowsSystemPreference = {
	tags: ['reduced-motion'],
	render: () =>
		defineAureliaStory({
			template: frame(375, 400),
			register,
			items: items(4, { hypes: ['watch', 'home', 'nearby', 'away'] }),
		}),
	play: async ({ canvasElement, globals }) => {
		// @spec components/infrastructure/fan/web/route/my-artists "Reduced motion preference"
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (import.meta.env.MODE === 'test') {
			await expect(typeof globals.reducedMotion).toBe('boolean')
			await expect(reduce).toBe(globals.reducedMotion)
		}
		await rendered(canvasElement, 4)
		const active = [
			...canvasElement.querySelectorAll<HTMLElement>(
				'.hype-dot[data-active="true"]',
			),
		]
		await expect(active.map((d) => d.dataset.level)).toEqual([
			'watch',
			'home',
			'nearby',
			'away',
		])
		for (const dot of active) {
			const pulses =
				dot.dataset.level === 'nearby' || dot.dataset.level === 'away'
			// The pulse runs in the two highest levels, and only with motion.
			await expect(getComputedStyle(dot).animationName).toBe(
				pulses && !reduce ? 'dot-pulse' : 'none',
			)
			// The static border and glow stay either way.
			const style = getComputedStyle(dot)
			await expect(style.borderTopStyle).toBe('solid')
			if (dot.dataset.level !== 'watch') {
				await expect(style.boxShadow).not.toBe('none')
			}
		}
	},
} satisfies Story

/**
 * The active dot of each level, in the artist's own colour: a row per level.
 * Runs in the project without reduced motion, where the pulses play.
 */
export const ActiveDotByLevel = {
	render: () =>
		defineAureliaStory({
			template: frame(375, 400),
			register,
			items: items(4, { hypes: ['watch', 'home', 'nearby', 'away'] }),
		}),
	play: async ({ canvasElement }) => {
		await rendered(canvasElement, 4)
		const dotOf = (id: string) => {
			const dot = hypeRow(canvasElement, id).dots.find(
				(d) => d?.dataset.active === 'true',
			)
			if (!dot) throw new Error(`no active dot for ${id}`)
			return dot
		}
		/** What the browser makes of a box-shadow written with the dot's colour. */
		const shadow = (dot: HTMLElement, value: string) => {
			const probe = document.createElement('span')
			probe.style.boxShadow = value
			dot.append(probe)
			const resolved = getComputedStyle(probe).boxShadow
			probe.remove()
			return resolved
		}
		const tone = (alpha: string) => `oklch(from var(--_color) l c h / ${alpha})`

		// @spec components/infrastructure/fan/web/route/my-artists "Active dot reflects hype tier CSS effects"
		// The level's name is the dot's `data-level`.
		const levels = ['watch', 'home', 'nearby', 'away']
		await expect(
			levels.map((_, i) => dotOf(`artist-${i + 1}`).dataset.level),
		).toEqual(levels)

		// WATCH: a 1px border of white at 10%, no glow.
		const watch = dotOf('artist-1')
		await expect(getComputedStyle(watch).boxShadow).toBe('none')
		await expect(getComputedStyle(watch).borderTopWidth).toBe('1px')
		await expect(getComputedStyle(watch).borderTopStyle).toBe('solid')
		await expect(getComputedStyle(watch).borderTopColor).toBe(
			resolveColor(watch, 'oklch(100% 0 0deg / 10%)'),
		)
		await expect(getComputedStyle(watch).animationName).toBe('none')

		// HOME: a 1px border in the artist's colour, the dot at 40%, a soft glow.
		const home = dotOf('artist-2')
		const homeStyle = getComputedStyle(home)
		await expect(homeStyle.borderTopWidth).toBe('1px')
		await expect(homeStyle.borderTopStyle).toBe('solid')
		await expect(homeStyle.borderTopColor).toBe(
			resolveColor(home, 'var(--_color)'),
		)
		await expect(homeStyle.opacity).toBe('0.4')
		await expect(homeStyle.boxShadow).toBe(
			shadow(home, `0 0 8px ${tone('30%')}`),
		)
		await expect(homeStyle.animationName).toBe('none')

		// NEARBY: a 2px border, a wider glow, the gentle pulse.
		const nearby = dotOf('artist-3')
		const nearbyStyle = getComputedStyle(nearby)
		await expect(nearbyStyle.borderTopWidth).toBe('2px')
		await expect(nearbyStyle.borderTopColor).toBe(
			resolveColor(nearby, 'var(--_color)'),
		)
		await expect(nearbyStyle.boxShadow).toBe(
			shadow(nearby, `0 0 16px ${tone('50%')}`),
		)
		await expect(nearbyStyle.animationName).toBe('dot-pulse')

		// AWAY: a 2px border, two glows, the strong (faster) pulse.
		const away = dotOf('artist-4')
		const awayStyle = getComputedStyle(away)
		await expect(awayStyle.borderTopWidth).toBe('2px')
		await expect(awayStyle.borderTopColor).toBe(
			resolveColor(away, 'var(--_color)'),
		)
		await expect(awayStyle.boxShadow).toBe(
			shadow(away, `0 0 24px ${tone('60%')}, 0 0 48px ${tone('20%')}`),
		)
		await expect(awayStyle.animationName).toBe('dot-pulse')
		await expect(Number.parseFloat(awayStyle.animationDuration)).toBeLessThan(
			Number.parseFloat(nearbyStyle.animationDuration),
		)

		// The colour is the artist's own, from the deterministic generator.
		for (const [i, dot] of [home, nearby, away].entries()) {
			const name = `Artist ${i + 2}`
			await expect(resolveColor(dot, 'var(--_color)')).toBe(
				resolveColor(dot, artistColor(name)),
			)
		}
	},
} satisfies Story
