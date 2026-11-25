import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
	composite,
	contrast,
	luminance,
	type Rgb,
	WCAG_AA,
} from '../../../.storybook/contrast'
import {
	finishMotion,
	nextPaint,
	pausableAnimations,
	seekMotion,
} from '../../../.storybook/motion'
import ja from '../../locales/ja/translation.json'
import { CelebrationOverlay } from './celebration-overlay'

type Tier = 'light' | 'postSignup'
type Backdrop = 'timetable' | 'empty'

interface Args {
	tier: Tier
	backdrop: Backdrop
}

const t = ja.timetable.celebration

const TIERS: Record<
	Tier,
	{ confetti: boolean; message: string; subMessage: string; hint: string }
> = {
	light: {
		confetti: false,
		message: t.complete,
		subMessage: t.found
			.replace('{{artists}}', '5')
			.replace('{{concerts}}', '12'),
		hint: t.tapToView,
	},
	postSignup: {
		confetti: true,
		message: t.welcome,
		subMessage: t.chasing,
		hint: '',
	},
}

/**
 * Story scaffolding: what the overlay sits over, sized by the viewport and the
 * app's tokens, never by fixed pixels.
 */
const SCAFFOLD_STYLE = `
	<style>
		.story-stage {
			min-block-size: 100dvb;
		}
		.story-card {
			margin: 0;
			padding: var(--space-m) var(--space-2xs);
			border-radius: var(--md-sys-shape-corner-large);
			color: oklch(15% 0 0deg);
			background: oklch(85% 0.15 var(--artist-hue));
		}
		.story-replay {
			position: fixed;
			inset-block-end: var(--space-s);
			inset-inline-start: var(--space-s);
			z-index: 1;
		}
	</style>
`

/** Bright stage cards with text, like a loaded timetable. */
const TIMETABLE = `
	<div class="grid-auto" style="--grid-min: 6rem">
		<div repeat.for="i of 12" style="--artist-hue: \${i * 30}">
			<p class="story-card">Artist \${i + 1} — Zepp Haneda</p>
		</div>
	</div>
`

const EMPTY = `
	<div class="[ center ] [ story-stage ]">
		<p>${ja.timetable.empty.title}</p>
	</div>
`

const meta = {
	title: 'Components/CelebrationOverlay',
	component: CelebrationOverlay,
	argTypes: {
		tier: {
			control: 'inline-radio',
			options: ['light', 'postSignup'],
			description:
				'Light: the onboarding timetable is ready (no confetti). Post-signup: confetti, sound and vibration, then the post-signup sheet.',
		},
		backdrop: {
			control: 'inline-radio',
			options: ['timetable', 'empty'],
			description: 'What the overlay is shown over.',
		},
	},
	args: { tier: 'postSignup', backdrop: 'empty' },
	// A phone; switch the viewport to see other sizes.
	globals: { viewport: { value: 'mobile1', isRotated: false } },
	// Shown as the app shows it: Japanese text under `lang="ja"`, which the
	// phrase-boundary line breaks need. Restored for the next story.
	beforeEach: () => {
		const lang = document.documentElement.lang
		document.documentElement.lang = 'ja'
		return () => {
			document.documentElement.lang = lang
		}
	},
} satisfies Meta<typeof CelebrationOverlay>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The overlay over a backdrop, with a button that plays it again (the overlay
 * itself shows once, like on the Timetable).
 */
const render = (args: Args) =>
	defineAureliaStory({
		template: `
			${SCAFFOLD_STYLE}
			<div class="story-stage">
				<div aria-hidden="true">${args.backdrop === 'timetable' ? TIMETABLE : EMPTY}</div>
				<button type="button" class="[ story-replay ] [ button ] [ state-layer ]" data-variant="outlined" click.trigger="replay()">
					Play again
				</button>
				<celebration-overlay
					repeat.for="r of runs"
					active.bind="true"
					confetti.bind="tier.confetti"
					message.bind="tier.message"
					sub-message.bind="tier.subMessage"
					hint.bind="tier.hint"
				></celebration-overlay>
			</div>
		`,
		props: {
			tier: TIERS[args.tier],
			runs: [0],
			replay(this: { runs: number[] }) {
				this.runs = [this.runs[0] + 1]
			},
		},
		register: [CelebrationOverlay],
	})

async function expectLines(canvasElement: HTMLElement, lines: string[]) {
	const overlay = canvasElement.querySelector<HTMLElement>(
		'.celebration-overlay',
	)
	if (!overlay) throw new Error('no overlay')
	await expect(overlay.dataset.state).toBe('active')
	const shown = [...overlay.querySelectorAll('p')].map((p) => p.textContent)
	await expect(shown).toEqual(lines)
	return overlay
}

/**
 * Every line is whole inside the screen: no line is wider than its box and the
 * column is no wider than the screen. (This story's viewport is a 320 px
 * phone, the narrowest the app supports.)
 */
async function expectFits(overlay: HTMLElement) {
	const problems: string[] = []
	if (overlay.scrollWidth > overlay.clientWidth) {
		problems.push(
			`the column is ${overlay.scrollWidth}px in a ${overlay.clientWidth}px screen`,
		)
	}
	for (const line of overlay.querySelectorAll<HTMLElement>('p')) {
		const box = line.getBoundingClientRect().width
		if (line.scrollWidth > line.clientWidth || box > overlay.clientWidth) {
			problems.push(
				`"${line.textContent?.replace(/\u200b/g, '|')}" scrolls ${line.scrollWidth}px in a ${line.clientWidth}px box (${box}px on a ${overlay.clientWidth}px screen)`,
			)
		}
	}
	await expect(problems).toEqual([])
}

/** The scrim the overlay paints, as a colour the canvas can composite. */
const scrimOf = (overlay: HTMLElement) =>
	getComputedStyle(overlay).backgroundColor

/**
 * What a reader can make of the page behind the scrim: the ratio between a
 * text pixel and the pixel next to it, both seen through the scrim. The blur,
 * which only makes it worse, is left out. Below 3:1, WCAG's lowest ratio for
 * any text, the text cannot be read.
 */
const UNREADABLE = 3

function seenThrough(overlay: HTMLElement, text: Element, ground: Element) {
	const scrim = scrimOf(overlay)
	const paint = (el: Element, key: 'color' | 'backgroundColor') =>
		getComputedStyle(el)[key]
	const pixel = composite(paint(ground, 'backgroundColor'), scrim)
	const letter = composite(
		paint(ground, 'backgroundColor'),
		paint(text, 'color'),
		scrim,
	)
	return { pixel, letter, ratio: contrast(letter, pixel) }
}

/** Each celebration line is read against the brightest thing behind it. */
function expectLinesLegible(overlay: HTMLElement, ground: Rgb[]) {
	const brightest = ground.reduce((a, b) =>
		luminance(a) > luminance(b) ? a : b,
	)
	const scrim = scrimOf(overlay)
	return [...overlay.querySelectorAll('p')].map((line) => {
		const behind = composite(`rgb(${brightest.join(',')})`, scrim)
		const ink = composite(
			`rgb(${behind.join(',')})`,
			getComputedStyle(line).color,
		)
		return contrast(ink, behind)
	})
}

/** The motion that matches the viewer's preference. */
async function expectMotion(canvasElement: HTMLElement, confetti: boolean) {
	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
	const headline = canvasElement.querySelector('.celebration-text')
	if (!headline) throw new Error('no headline')
	const pieces = canvasElement.querySelectorAll('.confetti')
	if (reduced) {
		// The headline fades in without scaling; no confetti.
		await expect(getComputedStyle(headline).animationName).toBe(
			'celebration-fade',
		)
		await expect(pieces).toHaveLength(0)
	} else {
		await expect(getComputedStyle(headline).animationName).toBe(
			'headline-enter',
		)
		await expect(pieces.length > 0).toBe(confetti)
	}
}

/** Post-signup over the Timetable empty state: dark, blurred scrim. */
export const PostSignupOverEmptyState = {
	tags: ['reduced-motion'],
	render,
	args: { tier: 'postSignup', backdrop: 'empty' },
	play: async ({ canvasElement }) => {
		const overlay = await expectLines(canvasElement, [t.welcome, t.chasing])
		await expectFits(overlay)
		const style = getComputedStyle(overlay)
		await expect(style.backdropFilter).toContain('blur')
		// The scrim fades in with its text, in step with its fade-out; with
		// motion reduced the fade is 100 ms.
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
			await expect(style.transitionProperty).toBe('opacity')
			await expect(style.transitionDuration).toBe('0.1s')
		} else {
			await expect(style.transitionProperty).toBe('opacity')
			await expect(style.transitionDuration).toBe('0.4s')
		}
		await expectMotion(canvasElement, true)

		// @spec components/infrastructure/fan/web/global/celebration-overlay "Empty-state text behind the post-signup celebration cannot be read"
		const page = composite(getComputedStyle(document.body).backgroundColor)
		const emptyText = canvasElement.querySelector('[aria-hidden="true"] p')
		if (!emptyText) throw new Error('no empty-state text')
		await expect(
			seenThrough(overlay, emptyText, document.body).ratio,
		).toBeLessThan(UNREADABLE)
		for (const ratio of expectLinesLegible(overlay, [page])) {
			await expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
		}
	},
} satisfies Story

/**
 * What the overlay lets through of a loaded timetable: its colours faintly, its
 * text not at all, on a scrim that is one flat colour so the edges are no
 * different from the middle.
 */
async function expectTimetableSeenThroughScrim(
	canvasElement: HTMLElement,
	overlay: HTMLElement,
) {
	const cards = [...canvasElement.querySelectorAll<HTMLElement>('.story-card')]
	await expect(cards.length).toBeGreaterThan(1)
	const page = composite(getComputedStyle(document.body).backgroundColor)
	const bare = composite(`rgb(${page.join(',')})`, scrimOf(overlay))
	const grounds: Rgb[] = []
	for (const card of cards) {
		const { pixel, ratio } = seenThrough(overlay, card, card)
		// No card text can be read through the scrim (and it is blurred) ...
		await expect(ratio).toBeLessThan(UNREADABLE)
		// ... while the card's colour is still told from the bare scrim.
		await expect(contrast(pixel, bare)).toBeGreaterThan(1.05)
		grounds.push(composite(getComputedStyle(card).backgroundColor))
	}
	// One flat colour from edge to edge: no gradient or vignette.
	await expect(getComputedStyle(overlay).backgroundImage).toBe('none')
	await expect(getComputedStyle(overlay).backdropFilter).toContain('blur')
	for (const ratio of expectLinesLegible(overlay, grounds)) {
		await expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
	}
}

/** Post-signup over a full timetable. */
export const PostSignupOverTimetable = {
	render,
	args: { tier: 'postSignup', backdrop: 'timetable' },
	play: async ({ canvasElement }) => {
		const overlay = await expectLines(canvasElement, [t.welcome, t.chasing])
		await expectFits(overlay)
		// @spec components/infrastructure/fan/web/global/celebration-overlay "Timetable colors remain visible at the screen edges"
		await expectTimetableSeenThroughScrim(canvasElement, overlay)
	},
} satisfies Story

/** The onboarding payoff over a full timetable: three lines, no confetti. */
export const LightOverTimetable = {
	tags: ['reduced-motion'],
	render,
	args: { tier: 'light', backdrop: 'timetable' },
	play: async ({ canvasElement }) => {
		const overlay = await expectLines(canvasElement, [
			t.complete,
			'5組のアーティストの12公演が見つかりました',
			t.tapToView,
		])
		await expectFits(overlay)
		await expectMotion(canvasElement, false)
		// @spec components/infrastructure/fan/web/global/celebration-overlay "Heading and sub-text stay legible over bright cards"
		await expectTimetableSeenThroughScrim(canvasElement, overlay)
	},
} satisfies Story

/**
 * The celebration opens: the scrim starts transparent and reaches full strength
 * over 400 ms while the headline scales up past its size and settles. The story
 * plays it again and steps through both.
 */
export const Opens = {
	render,
	args: { tier: 'postSignup', backdrop: 'empty' },
	play: async ({ canvasElement }) => {
		await expectLines(canvasElement, [t.welcome, t.chasing])
		within(canvasElement).getByRole('button', { name: 'Play again' }).click()
		const overlay = await waitFor(() => {
			const el = canvasElement.querySelector<HTMLElement>(
				'.celebration-overlay',
			)
			if (!el || !pausableAnimations(el).length)
				throw new Error('not opening yet')
			return el
		})
		const headline = canvasElement.querySelector(
			'.celebration-text',
		) as HTMLElement
		const all = pausableAnimations(overlay)
		const scrim = all.filter(
			(a) =>
				a instanceof CSSTransition &&
				a.transitionProperty === 'opacity' &&
				a.effect?.target === overlay,
		)
		const enter = all.filter(
			(a) =>
				a instanceof CSSAnimation &&
				a.animationName === 'headline-enter' &&
				a.effect?.target === headline,
		)
		await expect(scrim).toHaveLength(1)
		await expect(enter).toHaveLength(1)
		// @spec components/infrastructure/fan/web/global/celebration-overlay "The celebration opens"
		await expect(Number(scrim[0].effect?.getComputedTiming().duration)).toBe(
			400,
		)
		const opacity = () => Number.parseFloat(getComputedStyle(overlay).opacity)
		await seekMotion(scrim, 0)
		await expect(opacity()).toBeLessThan(0.05)
		await seekMotion(scrim, 0.1)
		await expect(opacity()).toBeGreaterThan(0.05)
		await expect(opacity()).toBeLessThan(1)
		// @spec components/infrastructure/fan/web/global/celebration-overlay "Post-signup confetti, sound and vibration"
		const scale = () => new DOMMatrix(getComputedStyle(headline).transform).a
		await seekMotion(enter, 0)
		await expect(scale()).toBeLessThan(1)
		await seekMotion(enter, 0.6)
		await expect(scale()).toBeGreaterThan(1.05)
		finishMotion([...scrim, ...enter])
		await nextPaint()
		await expect(scale()).toBe(1)
		await expect(opacity()).toBe(1)
	},
} satisfies Story

/** A tap dismisses the overlay; Play again shows it once more. */
export const PlayAgain = {
	render,
	args: { tier: 'light', backdrop: 'empty' },
	play: async ({ canvasElement }) => {
		const overlay = await expectLines(canvasElement, [
			t.complete,
			'5組のアーティストの12公演が見つかりました',
			t.tapToView,
		])
		overlay.click()
		await waitFor(
			() =>
				expect(
					canvasElement.querySelector<HTMLElement>('.celebration-overlay')
						?.dataset.state,
				).toBe('hidden'),
			{ timeout: 3000 },
		)

		await userEvent.click(
			within(canvasElement).getByRole('button', { name: 'Play again' }),
		)

		await waitFor(
			() =>
				expect(
					canvasElement.querySelector<HTMLElement>('.celebration-overlay')
						?.dataset.state,
				).toBe('active'),
			{ timeout: 3000 },
		)
	},
} satisfies Story
