import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement } from 'aurelia'
import { expect } from 'storybook/test'
import { composite, contrast, resolveColor } from '../../../.storybook/contrast'
import { artistHue } from '../../adapter/view/artist-color'
import { BeamVarsCustomAttribute } from '../../custom-attributes/beam-vars'
import type { Concert, DateGroup, LaneType } from '../../entities/concert'
import { ConcertHighway } from './concert-highway'
import { EventCard } from './event-card'

let seq = 0
function ev(
	artistName: string,
	lane: LaneType,
	matched: boolean,
	date: string,
): Concert {
	seq += 1
	return {
		id: `ev-${seq}`,
		artistName,
		artistId: `artist-${seq}`,
		venueName: 'Zepp DiverCity',
		locationLabel: '東京',
		date: new Date(date),
		startTime: '19:00',
		title: `${artistName} Live`,
		sourceUrl: 'https://example.com',
		isFirstParty: false,
		hypeLevel: lane === 'home' ? 'home' : lane === 'nearby' ? 'nearby' : 'away',
		matched,
		artistHue: artistHue(artistName),
	}
}

/**
 * Two date groups with matched cards across lanes. Multiple groups are required
 * because the sticky date separators only matter across a multi-group scroll,
 * and laser beams are generated one-per-matched-card.
 */
const DATE_GROUPS: DateGroup[] = [
	{
		label: '7月15日 (水)',
		dateKey: '2026-07-15',
		isFirstOfMonth: true,
		monthSeparatorLabel: '2026年7月',
		home: [ev('VAUNDY', 'home', true, '2026-07-15T19:00:00+09:00')],
		nearby: [
			ev('Mrs. GREEN APPLE', 'nearby', true, '2026-07-15T19:00:00+09:00'),
		],
		away: [ev('YOASOBI', 'away', false, '2026-07-15T19:00:00+09:00')],
	},
	{
		label: '7月18日 (土)',
		dateKey: '2026-07-18',
		isFirstOfMonth: false,
		monthSeparatorLabel: '',
		home: [ev('Aimer', 'home', true, '2026-07-18T18:00:00+09:00')],
		nearby: [],
		away: [ev('King Gnu', 'away', false, '2026-07-18T18:00:00+09:00')],
	},
]

/**
 * Enough date groups to push most of them out of the viewport — the condition the
 * off-screen beam guard needs, and the one a two-group fixture cannot create.
 */
const MANY_GROUPS: DateGroup[] = Array.from({ length: 20 }, (_, i) => {
	const day = 1 + i
	const date = `2026-08-${String(day).padStart(2, '0')}`
	return {
		label: `8月${day}日`,
		dateKey: date,
		isFirstOfMonth: i === 0,
		monthSeparatorLabel: i === 0 ? '2026年8月' : '',
		home: [ev('VAUNDY', 'home', true, `${date}T19:00:00+09:00`)],
		nearby: [ev('Aimer', 'nearby', true, `${date}T19:00:00+09:00`)],
		away: [ev('King Gnu', 'away', false, `${date}T19:00:00+09:00`)],
	}
})

/**
 * Groups of deliberately uneven height. Height is what the defect turned on: a
 * saved pixel offset only misses if the groups it counts past are not all the
 * size the browser guessed, so a list of identical groups would pass a broken
 * implementation.
 */
const UNEVEN_GROUPS: DateGroup[] = Array.from({ length: 30 }, (_, i) => {
	const day = 1 + i
	const date = `2026-09-${String(day).padStart(2, '0')}`
	const count = 1 + (i % 4)
	return {
		label: `9月${day}日`,
		dateKey: date,
		isFirstOfMonth: i === 0,
		monthSeparatorLabel: i === 0 ? '2026年9月' : '',
		home: Array.from({ length: count }, () =>
			ev('VAUNDY', 'home', true, `${date}T19:00:00+09:00`),
		),
		nearby: [],
		away: Array.from({ length: 1 + ((i + 2) % 3) }, () =>
			ev('King Gnu', 'away', false, `${date}T19:00:00+09:00`),
		),
	}
})

// Matched cards across both groups → expected laser-beam count.
const MATCHED_COUNT = DATE_GROUPS.flatMap((g) => [
	...g.home,
	...g.nearby,
	...g.away,
]).filter((e) => e.matched).length

/** The card a beam follows, matched by value rather than built into a selector. */
function cardFor(root: HTMLElement, timeline: string): HTMLElement | undefined {
	return [...root.querySelectorAll<HTMLElement>('[data-live-card]')].find(
		(card) => card.dataset.beamName === timeline,
	)
}

function highwayStory(dateGroups: DateGroup[], hideAway = false) {
	return defineAureliaStory({
		// A sized grid host so the highway (block-size: 100%) lays out its lanes.
		template: `
			<div style="block-size: 560px; display: grid;">
				<concert-highway date-groups.bind="dateGroups" show-beams.bind="true" readonly.bind="true" hide-away.bind="hideAway"></concert-highway>
			</div>
		`,
		props: { dateGroups, hideAway },
		register: [ConcertHighway, EventCard, BeamVarsCustomAttribute],
	})
}

/**
 * The layout contract the timetable rests on: every date group's lanes line up
 * with the stage header's columns. The lanes used to inherit those columns by
 * chaining `subgrid` from the root; each group now declares them itself so it
 * can carry containment, and this asserts the two definitions have not drifted.
 *
 * Checks a deep group as well as the first, because a drift that only shows up
 * after the initially-rendered rows is exactly what a viewport-scoped render
 * would hide.
 */
/**
 * Wait until the rows in view have been dealt in. The deal-in moves the lanes
 * (a transform), so anything that measures where a lane or a card is reads it
 * once the rows are at rest. Rows out of view have not been triggered and are
 * not waited for.
 */
async function dealtIn(root: HTMLElement): Promise<void> {
	await new Promise((r) => requestAnimationFrame(() => r(null)))
	await Promise.all(
		root
			.getAnimations({ subtree: true })
			.filter(
				(a) =>
					(a as CSSAnimation).animationName === 'deal-in' &&
					a.playState === 'running',
			)
			.map((a) => a.finished.catch(() => undefined)),
	)
}

/**
 * An element's layout box, without transforms: its position summed up the
 * offset-parent chain. The deal-in moves the lanes with a transform, and rows
 * out of view hold its opening frame until they come into view, so a
 * transformed box says nothing about the columns.
 */
function layoutBox(el: HTMLElement): { left: number; width: number } {
	let left = 0
	for (
		let n: HTMLElement | null = el;
		n;
		n = n.offsetParent as HTMLElement | null
	) {
		left += n.offsetLeft + n.clientLeft
	}
	return { left, width: el.offsetWidth }
}

async function assertLanesAlignWithStageHeader(
	canvasElement: HTMLElement,
	expectedLanes: number,
) {
	const headers = [
		...canvasElement.querySelectorAll<HTMLElement>('.stage-header > span'),
	]
	await expect(headers.length).toBe(expectedLanes)

	const groups = [
		...canvasElement.querySelectorAll<HTMLElement>(
			'.concert-scroll > .date-group',
		),
	]
	const probes = [groups[0], groups[groups.length - 1]].filter(Boolean)

	for (const group of probes) {
		const lanes = [...group.querySelectorAll<HTMLElement>('.lane')]
		await expect(lanes.length).toBe(expectedLanes)

		for (const [i, lane] of lanes.entries()) {
			const head = layoutBox(headers[i])
			const box = layoutBox(lane)
			// Offsets are whole pixels: a column of fractional width lands within
			// one of the header's.
			await expect(Math.abs(box.left - head.left)).toBeLessThanOrEqual(1)
			await expect(Math.abs(box.width - head.width)).toBeLessThanOrEqual(1)

			// A card must never spill past its lane — the visible symptom when the
			// column definition breaks.
			const card = lane.querySelector<HTMLElement>('.event-card')
			if (card) {
				await expect(card.offsetWidth).toBeLessThanOrEqual(box.width)
			}
		}
	}
}

const meta = {
	title: 'LiveHighway/ConcertHighway',
	component: ConcertHighway,
} satisfies Meta<typeof ConcertHighway>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The three-lane timetable. Guards its layout contract: lanes line up with the
 * stage header, the date separators stay `position: sticky`, and one laser beam
 * renders per matched card of a built date.
 */
export const PopulatedTimetable = {
	render: () => highwayStory(DATE_GROUPS),
	play: async ({ canvasElement }) => {
		const groups = canvasElement.querySelectorAll<HTMLElement>(
			'.concert-scroll > .date-group',
		)
		// A short list fits in the window, so every date is built.
		await expect(groups.length).toBe(DATE_GROUPS.length)

		await assertLanesAlignWithStageHeader(canvasElement, 3)

		// @spec components/infrastructure/fan/web/global/live-highway "Festival-style color-coded STAGE headers"
		for (const span of canvasElement.querySelectorAll<HTMLElement>(
			'.stage-header > span',
		)) {
			const style = getComputedStyle(span)
			await expect(style.fontFamily.startsWith('Righteous')).toBe(true)
			await expect([
				style.fontSize,
				style.fontWeight,
				style.textTransform,
			]).toEqual(['24px', '400', 'uppercase'])
			await expect(style.color).toBe(
				resolveColor(span, 'var(--md-sys-color-surface)'),
			)
			await expect(style.backgroundColor).toBe(
				resolveColor(span, `var(--color-stage-${span.dataset.stage})`),
			)
			// Readable on every stage colour: 24 px is large text, 3:1 (WCAG 1.4.3).
			await expect(
				contrast(composite(style.backgroundColor), composite(style.color)),
			).toBeGreaterThanOrEqual(3)
		}

		// @spec components/infrastructure/fan/web/route/dashboard "Viewport-scoping off-screen content does not regress sticky headers or shift layout"
		// Sticky date separators, alongside the lane alignment asserted above.
		const separator =
			canvasElement.querySelector<HTMLElement>('.date-separator')
		if (!separator) throw new Error('date-separator not rendered')
		await expect(getComputedStyle(separator).position).toBe('sticky')

		// Every card carries its artist's hue as a number: the colour identity
		// the card's gradients are drawn from.
		for (const card of canvasElement.querySelectorAll<HTMLElement>(
			'.event-card',
		)) {
			const hue = card.style.getPropertyValue('--artist-hue').trim()
			await expect(Number.isFinite(Number.parseFloat(hue))).toBe(true)
		}

		// One laser beam per matched card of a built date.
		const beams = canvasElement.querySelectorAll('.laser-beam')
		await expect(beams.length).toBe(MATCHED_COUNT)
	},
} satisfies Story

/** A long timetable: 225 dates, the size of the reference account. */
const LONG_GROUPS: DateGroup[] = Array.from({ length: 225 }, (_, i) => {
	const d = new Date(Date.UTC(2026, 0, 1 + i))
	const date = d.toISOString().slice(0, 10)
	return {
		label: date,
		dateKey: date,
		isFirstOfMonth: d.getUTCDate() === 1,
		monthSeparatorLabel: '',
		home: [ev('VAUNDY', 'home', i % 5 === 0, `${date}T19:00:00+09:00`)],
		nearby: [ev('Aimer', 'nearby', false, `${date}T19:00:00+09:00`)],
		away: [],
	}
})

/**
 * The render-cost guard. It used to assert `content-visibility` on every date
 * group — which skipped style and layout for off-screen dates but still built
 * all of them. What bounds the cost now is the date window: of 225 loaded dates
 * only a window is built, and nothing is left for containment to skip.
 */
export const WindowedLongTimetable = {
	render: () => highwayStory(LONG_GROUPS),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/live-highway "Festival-style color-coded STAGE headers"
		// The header stays at the top while the timetable scrolls: it sits
		// outside the scrolling list rather than being position: sticky.
		const stageHeader = canvasElement.querySelector(
			'.stage-header',
		) as HTMLElement
		const scroller = canvasElement.querySelector(
			'.concert-scroll',
		) as HTMLElement
		await expect(scroller.contains(stageHeader)).toBe(false)
		const top = stageHeader.getBoundingClientRect().top
		scroller.scrollTo({ top: 200, behavior: 'instant' })
		await expect(scroller.scrollTop).toBeGreaterThan(0)
		await expect(stageHeader.getBoundingClientRect().top).toBe(top)
		scroller.scrollTo({ top: 0, behavior: 'instant' })
		const groups = [
			...canvasElement.querySelectorAll<HTMLElement>(
				'.concert-scroll > .date-group',
			),
		]
		await expect(groups.length).toBeGreaterThan(0)
		await expect(groups.length).toBeLessThanOrEqual(24)
		await expect(groups[0].dataset.dateKey).toBe(LONG_GROUPS[0].dateKey)

		for (const group of groups) {
			await expect(getComputedStyle(group).contentVisibility).not.toBe('auto')
		}

		// Beams exist only for matched concerts of built dates.
		const built = new Set(groups.map((g) => g.dataset.dateKey))
		const expected = LONG_GROUPS.filter((g) => built.has(g.dateKey)).flatMap(
			(g) => g.home.filter((e) => e.matched),
		).length
		await expect(canvasElement.querySelectorAll('.laser-beam').length).toBe(
			expected,
		)

		await assertLanesAlignWithStageHeader(canvasElement, 3)
	},
} satisfies Story

/**
 * Motion follows the fan's system preference. The story runs twice: in the
 * `storybook` project, where motion is allowed, and in the
 * `storybook-reduced-motion` project, whose browser requests reduced motion. It
 * reads the preference from the browser and asserts the matching presentation,
 * so the same story is valid in either context.
 *
 * Under Vitest each project also names the preference it emulates in the
 * `reducedMotion` global. The story first checks that the browser reports that
 * preference, so a project whose emulation silently stops working fails here
 * instead of passing both runs on the same branch.
 */
export const MotionFollowsSystemPreference = {
	tags: ['reduced-motion'],
	render: () => highwayStory(DATE_GROUPS),
	play: async ({ canvasElement, globals }) => {
		// @spec components/infrastructure/fan/web/route/dashboard "Reduced motion is respected"
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (import.meta.env.MODE === 'test') {
			await expect(typeof globals.reducedMotion).toBe('boolean')
			await expect(reduce).toBe(globals.reducedMotion)
		}

		const cards = [
			...canvasElement.querySelectorAll<HTMLElement>('.event-card'),
		]
		await expect(cards.length).toBeGreaterThan(0)
		for (const card of cards) {
			// The press feedback, the shared state layer's fade, is the card's
			// only motion: the card itself does not move.
			await expect(getComputedStyle(card).transitionDuration).toBe('0s')
			await expect(getComputedStyle(card, '::before').transitionDuration).toBe(
				reduce ? '0s' : '0.1s',
			)
		}

		// @spec components/infrastructure/fan/web/global/live-highway "Card treatments hold still"
		// The matched and unmatched treatments never animate, and a matched card
		// keeps its full light (glow, beam, glowing name) in either preference.
		for (const card of cards) {
			await expect(getComputedStyle(card).animationName).toBe('none')
			await expect(getComputedStyle(card, '::before').animationName).toBe(
				'none',
			)
			await expect(getComputedStyle(card, '::after').animationName).toBe('none')
		}
		const matchedCards = cards.filter((card) =>
			card.hasAttribute('data-matched'),
		)
		await expect(matchedCards.length).toBeGreaterThan(0)
		for (const card of matchedCards) {
			await expect(getComputedStyle(card).boxShadow).not.toBe('none')
			await expect(getComputedStyle(card, '::after').maskImage).toContain(
				'radial-gradient',
			)
			const name = card.querySelector<HTMLElement>('.artist-name')
			if (!name) throw new Error('artist name not rendered')
			await expect(getComputedStyle(name).textShadow).not.toBe('none')
		}

		const beams = [
			...canvasElement.querySelectorAll<HTMLElement>('.laser-beam'),
		]
		await expect(beams.length).toBe(MATCHED_COUNT)
		for (const beam of beams) {
			await expect(getComputedStyle(beam).animationName).toBe(
				reduce ? 'none' : 'beam-length',
			)
		}
	},
} satisfies Story

/**
 * Many groups in a short viewport. Dates outside the window are not built at
 * all, so there is nothing of theirs to style or lay out: the window's own
 * dates are in the document and rendered, and the dates past it are absent
 * until the fan scrolls toward them.
 */
export const OffScreenDatesNotBuilt = {
	render: () => highwayStory(MANY_GROUPS),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/route/dashboard "Off-screen timetable content is not styled or laid out eagerly"
		const scroll = canvasElement.querySelector<HTMLElement>('.concert-scroll')
		if (!scroll) throw new Error('concert-scroll not rendered')

		const built = [
			...scroll.querySelectorAll<HTMLElement>(':scope > .date-group'),
		]
		// The story only proves anything if the list is longer than the window.
		await expect(MANY_GROUPS.length).toBeGreaterThan(built.length)
		await expect(built.length).toBeGreaterThan(0)

		const first = built[0].querySelector<HTMLElement>('.event-card')
		if (!first) throw new Error('event-card not rendered')
		await expect(first.checkVisibility()).toBe(true)

		// The last loaded date has no element at all, so it cannot contribute
		// style, layout or paint work.
		const last = MANY_GROUPS[MANY_GROUPS.length - 1].dateKey
		await expect(built.map((g) => g.dataset.dateKey)).not.toContain(last)
	},
} satisfies Story

/**
 * All Nearby collapses the AWAY column to zero width, so the highway reads as
 * two lanes. The away header span and away lane leave the DOM while the named
 * grid areas stay intact. Storied separately because the flattened date group
 * repeats the root's column definition — if the two ever diverge, the two-lane
 * mode is where it shows first.
 */
export const HideAwayTwoLane = {
	render: () => highwayStory(DATE_GROUPS, true),
	play: async ({ canvasElement }) => {
		await assertLanesAlignWithStageHeader(canvasElement, 2)

		const away = canvasElement.querySelector('[data-lane="away"]')
		await expect(away).toBeNull()
	},
} satisfies Story

/**
 * Beams on. They are driven entirely by each anchor concert's view timeline, so
 * this asserts the wiring the CSS depends on: a scoped timeline name per beam on
 * the host, a matching `view-timeline` on the card — declared by the stylesheet
 * from the name the card carries — and `animation-timeline` on the beam. It deliberately does not assert beam geometry — that is now the
 * browser's job, and there is no script left to verify.
 */
export const BeamsEnabled = {
	render: () => highwayStory(DATE_GROUPS),
	play: async ({ canvasElement }) => {
		const beams = [
			...canvasElement.querySelectorAll<HTMLElement>('.laser-beam'),
		]
		await expect(beams.length).toBe(MATCHED_COUNT)

		const host = canvasElement.querySelector<HTMLElement>('concert-highway')
		if (!host) throw new Error('concert-highway not rendered')
		const scope = getComputedStyle(host).timelineScope

		for (const beam of beams) {
			const name = beam.dataset.beamTimeline ?? ''

			// The beam is not a descendant of its card, so the name must be scoped
			// on a common ancestor or the timeline silently fails to resolve.
			await expect(scope).toContain(name)
			await expect(getComputedStyle(beam).animationTimeline).toBe(name)

			const card = cardFor(canvasElement, name)
			if (!card) throw new Error(`no card for beam ${name}`)
			await expect(getComputedStyle(card).viewTimelineName).toBe(name)
		}
	},
} satisfies Story

/**
 * Many groups in a short viewport. Two things must hold at once, and each is a
 * defect this component actually shipped.
 *
 * A beam must land on its card. The length was once derived from scroll progress
 * over the plain `cover` range against a viewport-sized overlay — two spans that
 * do not match the distance the beam covers — so it fell short near the top of
 * the screen and overshot near the bottom. It is exact now only because the
 * range and the overlay both describe that same distance, and either one drifting
 * back would show up here as a gap between the beam's foot and the card.
 *
 * A beam for a concert the fan has not reached must be dark. The animation once
 * carried `animation-fill-mode: both`, whose backwards fill held the opening
 * keyframe — the full-length beam — so every matched concert in the timetable lit
 * up at once.
 */
export const BeamsDarkOffScreen = {
	render: () => highwayStory(MANY_GROUPS),
	play: async ({ canvasElement }) => {
		const scroll = canvasElement.querySelector<HTMLElement>('.concert-scroll')
		if (!scroll) throw new Error('concert-scroll not rendered')

		// A view timeline can only be declared while its group is being rendered,
		// so the component re-declares them once the browser has settled which
		// groups those are. Let that frame happen before measuring.
		await new Promise((r) =>
			requestAnimationFrame(() => requestAnimationFrame(r)),
		)
		// The beam lands where the card settles; measure once it has.
		await dealtIn(canvasElement)

		const edge = scroll.getBoundingClientRect()

		const beams = [
			...canvasElement.querySelectorAll<HTMLElement>('.laser-beam'),
		]
		await expect(beams.length).toBeGreaterThan(10)

		let offScreen = 0
		let offScreenLit = 0
		let onScreenLit = 0
		for (const beam of beams) {
			const card = cardFor(canvasElement, beam.dataset.beamTimeline ?? '')
			if (!card) continue
			const box = card.getBoundingClientRect()
			const rect = beam.getBoundingClientRect()
			const lit = rect.height > 1

			if (box.top < edge.top || box.top > edge.bottom) {
				offScreen += 1
				if (lit) offScreenLit += 1
				continue
			}
			if (!lit) continue
			onScreenLit += 1

			// The beam's foot sits on the card's top edge. A tolerance of 1px is for
			// fractional layout — anything larger is the mapping having drifted.
			await expect(Math.abs(rect.bottom - box.top)).toBeLessThan(1)
		}

		// The story only proves anything if there is something off screen to prove
		// it about, and something on screen to measure.
		await expect(offScreen).toBeGreaterThan(5)
		await expect(offScreenLit).toBe(0)
		await expect(onScreenLit).toBeGreaterThan(0)
	},
} satisfies Story

/**
 * Leaving the timetable deep in the list and coming back to the same date.
 *
 * Coming back destroys every group, and the window is then built around the
 * remembered date, so the dates above it do not exist yet and a saved pixel
 * offset would count past a different set of groups. What is saved is therefore
 * the date at the top edge, and the assertion is that the fan gets that date
 * back — not that some number round trips.
 */
export const ScrollAnchorSurvivesRerender = {
	render: () => highwayStory(UNEVEN_GROUPS),
	play: async ({ canvasElement }) => {
		const host = canvasElement.querySelector<HTMLElement>('concert-highway')
		if (!host) throw new Error('concert-highway not rendered')
		const vm = CustomElement.for<ConcertHighway>(host).viewModel
		const scroll = canvasElement.querySelector<HTMLElement>('.concert-scroll')
		if (!scroll) throw new Error('concert-scroll not rendered')

		const settle = async () => {
			for (let i = 0; i < 3; i++) {
				await new Promise((r) => requestAnimationFrame(() => r(null)))
			}
		}
		const topDateKey = () => {
			const edge = scroll.getBoundingClientRect().top
			for (const group of scroll.querySelectorAll<HTMLElement>(
				'[data-date-key]',
			)) {
				if (group.getBoundingClientRect().bottom > edge + 0.5) {
					return group.dataset.dateKey
				}
			}
			return undefined
		}

		// Scroll the way a fan does, a screen at a time, so the window grows the
		// way it does in use.
		for (let i = 1; i <= 8; i++) {
			scroll.scrollTo({ top: i * scroll.clientHeight, behavior: 'instant' })
			await settle()
		}
		const left = topDateKey()
		await expect(left).toBeDefined()
		// Deep enough that the remembered date is not in the first window.
		await expect(scroll.scrollTop).toBeGreaterThan(1000)

		const saved = vm.scrollAnchor
		await expect(saved?.dateKey).toBe(left)

		// Leave and come back: every group element is destroyed and rebuilt, and
		// the window is built afresh around the remembered date — the way the
		// dashboard hands it over on re-entry — so that date exists to land on.
		vm.dateGroups = []
		await settle()
		vm.initialAnchor = saved ?? null
		vm.dateGroups = UNEVEN_GROUPS
		await settle()

		vm.scrollAnchor = saved
		await settle()

		await expect(topDateKey()).toBe(left)
	},
} satisfies Story

/**
 * The loading placeholder. A new visual state gets its own story per the repo's
 * story contract — and this one earns it, because its whole purpose is that the
 * swap to real concerts moves nothing: it is built from the timetable's own
 * structure, so its lanes must line up with the stage header exactly as real
 * content does.
 */
export const LoadingPlaceholder = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="block-size: 560px; display: grid;">
					<concert-highway date-groups.bind="[]" loading.bind="true" readonly.bind="true"></concert-highway>
				</div>
			`,
			props: {},
			register: [ConcertHighway, EventCard, BeamVarsCustomAttribute],
		}),
	play: async ({ canvasElement }) => {
		// The frame is on screen while the concerts are not — that is the point.
		await expect(
			canvasElement.querySelectorAll('.stage-header > span'),
		).toHaveLength(3)

		const rows = [
			...canvasElement.querySelectorAll<HTMLElement>('.date-group-skeleton'),
		]
		await expect(rows.length).toBeGreaterThan(0)
		await assertLanesAlignWithStageHeader(canvasElement, 3)

		// Decorative only: it must not be announced, and it must not animate in —
		// animating a placeholder only delays the content it stands in for.
		for (const row of rows) {
			await expect(row.getAttribute('aria-hidden')).toBe('true')
			await expect(getComputedStyle(row).animationName).toBe('none')
		}

		// No real cards yet.
		await expect(canvasElement.querySelector('.event-card')).toBeNull()
	},
} satisfies Story

/** Dates across three months, a few per month, every lane filled. */
const THREE_MONTHS: DateGroup[] = [
	['2026-11', 10],
	['2026-12', 10],
	['2027-01', 10],
].flatMap(([month, count]) =>
	Array.from({ length: count as number }, (_, i) => {
		const day = 1 + i * 3
		const date = `${month}-${String(day).padStart(2, '0')}`
		return {
			label: date,
			dateKey: date,
			isFirstOfMonth: i === 0,
			monthSeparatorLabel: i === 0 ? String(month) : '',
			home: [ev('VAUNDY', 'home', false, `${date}T19:00:00+09:00`)],
			nearby: [ev('Aimer', 'nearby', false, `${date}T19:00:00+09:00`)],
			away: [ev('King Gnu', 'away', false, `${date}T19:00:00+09:00`)],
		}
	}),
)

/** The timetable opened at `dateKey`, as on re-entry (null: the first date). */
function monthJumpStory(dateKey: string | null) {
	return defineAureliaStory({
		template: `
			<div style="block-size: 560px; display: grid;">
				<concert-highway date-groups.bind="dateGroups" initial-anchor.bind="anchor" show-beams.bind="false" readonly.bind="true"></concert-highway>
			</div>
		`,
		props: {
			dateGroups: THREE_MONTHS,
			anchor: dateKey === null ? null : { dateKey, offset: 0 },
		},
		register: [ConcertHighway, EventCard, BeamVarsCustomAttribute],
	})
}

async function frames(n = 3): Promise<void> {
	for (let i = 0; i < n; i++) {
		await new Promise((r) => requestAnimationFrame(() => r(null)))
	}
}

/** Which month-jump buttons are on screen: `prev`, `next`. */
function shownJumps(root: HTMLElement): string[] {
	return [...root.querySelectorAll<HTMLElement>('.month-jump-button')]
		.filter((b) => b.checkVisibility())
		.map((b) => b.dataset.direction ?? '')
}

/**
 * Month jump, before the fan scrolls: the list is at its top, and a browser
 * that can tell (Chromium here) shows neither button.
 */
export const MonthJumpBeforeScrolling = {
	render: () => monthJumpStory(null),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/route/dashboard "Not shown before the fan scrolls"
		await frames()
		await expect(CSS.supports('container-type: scroll-state')).toBe(true)
		await expect(shownJumps(canvasElement)).toEqual([])

		// One small scroll and the capsule is there, with only the next month:
		// the list starts in its first month.
		const scroll = canvasElement.querySelector<HTMLElement>('.concert-scroll')
		if (!scroll) throw new Error('concert-scroll not rendered')
		scroll.scrollTo({ top: 40, behavior: 'instant' })
		await frames()
		await expect(shownJumps(canvasElement)).toEqual(['next'])
	},
} satisfies Story

/** Month jump in a middle month: both directions. */
export const MonthJumpBoth = {
	render: () => monthJumpStory('2026-12-07'),
	play: async ({ canvasElement }) => {
		await frames()
		await expect(shownJumps(canvasElement)).toEqual(['prev', 'next'])

		// Each button is named with its own target month.
		const [prev, next] =
			canvasElement.querySelectorAll<HTMLElement>('.month-jump-button')
		await expect(prev.getAttribute('aria-label')).toBe('11月へ移動')
		await expect(next.getAttribute('aria-label')).toBe('1月へ移動')

		// The capsule stands clear of where the FAB rises into the list.
		const capsule = canvasElement.querySelector<HTMLElement>(
			'.month-jump-capsule',
		)
		const scroll = canvasElement.querySelector<HTMLElement>('.concert-scroll')
		if (!capsule || !scroll) throw new Error('capsule not rendered')
		const gap =
			scroll.getBoundingClientRect().bottom -
			capsule.getBoundingClientRect().bottom
		await expect(gap).toBeGreaterThanOrEqual(32)
	},
} satisfies Story

/** Month jump in the last month: previous only. */
export const MonthJumpPreviousOnly = {
	render: () => monthJumpStory('2027-01-10'),
	play: async ({ canvasElement }) => {
		await frames()
		await expect(shownJumps(canvasElement)).toEqual(['prev'])
	},
} satisfies Story

/** Month jump in the first month, after a scroll: next only. */
export const MonthJumpNextOnly = {
	render: () => monthJumpStory('2026-11-07'),
	play: async ({ canvasElement }) => {
		await frames()
		await expect(shownJumps(canvasElement)).toEqual(['next'])

		// @spec components/infrastructure/fan/web/route/dashboard "Named for assistive technology"
		// A November date at the top: the next-month button, icon-only, is
		// named for December in the active language (the stories run in
		// Japanese).
		const next = canvasElement.querySelector<HTMLElement>(
			'.month-jump-button[data-direction="next"]',
		)
		await expect(next?.getAttribute('aria-label')).toBe('12月へ移動')
		await expect(next?.textContent?.trim()).toBe('')
	},
} satisfies Story

/**
 * A jump in the real component: the next month's first date lands at the top,
 * and the previous-month button then leads back.
 */
export const MonthJumpMoves = {
	render: () => monthJumpStory('2026-11-07'),
	play: async ({ canvasElement }) => {
		await frames()
		const scroll = canvasElement.querySelector<HTMLElement>('.concert-scroll')
		if (!scroll) throw new Error('concert-scroll not rendered')
		const topKey = () => {
			const edge = scroll.getBoundingClientRect().top
			return [...scroll.querySelectorAll<HTMLElement>('[data-date-key]')].find(
				(g) => g.getBoundingClientRect().bottom > edge + 0.5,
			)?.dataset.dateKey
		}
		// The jump's smooth scroll ends with a `scrollend`; the instant
		// placement before it reports one of its own in the first frame.
		const settled = async () => {
			await frames(1)
			await new Promise((r) => {
				scroll.addEventListener('scrollend', r, { once: true })
				setTimeout(r, 1500)
			})
		}

		const next = canvasElement.querySelector<HTMLElement>(
			'.month-jump-button[data-direction="next"]',
		)
		if (!next) throw new Error('no next-month button')
		const nextAt = next.getBoundingClientRect().left
		next.click()
		await settled()
		await frames()
		await expect(topKey()).toBe('2026-12-01')
		// The previous-month button has appeared beside it, and the next-month
		// button is still where the fan tapped it.
		await expect(shownJumps(canvasElement)).toEqual(['prev', 'next'])
		await expect(
			Math.abs(next.getBoundingClientRect().left - nextAt),
		).toBeLessThanOrEqual(0.5)

		const prev = canvasElement.querySelector<HTMLElement>(
			'.month-jump-button[data-direction="prev"]',
		)
		prev?.click()
		await settled()
		await frames()
		await expect(topKey()).toBe('2026-11-01')
		// Back at the first loaded date the list is at its top again, and the
		// capsule stays, with the next-month button the fan came back with.
		await expect(scroll.scrollTop).toBe(0)
		await expect(shownJumps(canvasElement)).toEqual(['next'])
	},
} satisfies Story

/**
 * The deal-in of date rows. The story runs in both storybook projects and
 * asserts the motion that matches the browser's preference: with motion, each
 * row's lanes run one 800 ms animation, started 100 ms apart (HOME, NEAR,
 * AWAY) by the row coming into view; under reduced motion, none.
 *
 * Also run on a grown window: `sibling-index()` counts only a row's lanes, so
 * rows added while scrolling get the same 0/100/200 ms steps as the first
 * ones (the removed reveal counted rows and capped every later row at the
 * same delay).
 */
export const DealIn = {
	tags: ['reduced-motion'],
	render: () => highwayStory(LONG_GROUPS),
	play: async ({ canvasElement, globals }) => {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (import.meta.env.MODE === 'test') {
			await expect(reduce).toBe(globals.reducedMotion)
		}
		const scroll = canvasElement.querySelector<HTMLElement>('.concert-scroll')
		if (!scroll) throw new Error('concert-scroll not rendered')

		/** The deal-in animations of the row at the top of the list. */
		const rowAnimations = (row: HTMLElement) =>
			[...row.querySelectorAll<HTMLElement>('.lane')].map((lane) =>
				lane
					.getAnimations()
					.filter((a) => (a as CSSAnimation).animationName === 'deal-in')
					.map((a) => a.effect?.getComputedTiming()),
			)
		const visibleRow = () => {
			const edge = scroll.getBoundingClientRect().top
			const row = [
				...scroll.querySelectorAll<HTMLElement>('.date-group[data-date-key]'),
			].find((g) => g.getBoundingClientRect().top >= edge - 0.5)
			if (!row) throw new Error('no row in view')
			return row
		}

		const check = async (row: HTMLElement) => {
			const lanes = rowAnimations(row)
			// @spec components/infrastructure/fan/web/global/live-highway "Reduced motion"
			if (reduce) {
				await expect(lanes.flat()).toEqual([])
				return
			}
			// @spec components/infrastructure/fan/web/global/live-highway "Scrolling down"
			await expect(lanes.map((l) => l.length)).toEqual([1, 1, 1])
			await expect(lanes.map((l) => l[0]?.delay)).toEqual([0, 100, 200])
			await expect(lanes.map((l) => l[0]?.duration)).toEqual([800, 800, 800])

			// The row in view was triggered: it settles, fully shown, in place.
			await new Promise((r) => setTimeout(r, 1100))
			for (const lane of row.querySelectorAll<HTMLElement>('.lane')) {
				await expect(getComputedStyle(lane).opacity).toBe('1')
				await expect(
					['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(
						getComputedStyle(lane).transform,
					),
				).toBe(true)
			}
		}

		await frames()
		await check(visibleRow())

		// Grow the window by scrolling, then check a row added on the way.
		for (let i = 1; i <= 6; i++) {
			scroll.scrollTo({ top: i * scroll.clientHeight, behavior: 'instant' })
			await frames()
		}
		await expect(
			scroll.querySelectorAll('.date-group[data-date-key]').length,
		).toBeGreaterThan(12)
		await check(visibleRow())
	},
} satisfies Story
