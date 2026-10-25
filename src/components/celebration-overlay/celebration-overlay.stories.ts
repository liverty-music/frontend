import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import ja from '../../locales/ja/translation.json'
import { CelebrationOverlay } from './celebration-overlay'

type Tier = 'light' | 'postSignup'
type Backdrop = 'timetable' | 'empty'

interface Args {
	tier: Tier
	backdrop: Backdrop
}

const t = ja.dashboard.celebration

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
			border-radius: var(--radius-card);
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
		<p>${ja.dashboard.empty.title}</p>
	</div>
`

const meta = {
	title: 'Components/CelebrationOverlay',
	component: CelebrationOverlay,
	tags: ['test', 'autodocs'],
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
 * itself shows once, like on the Dashboard).
 */
const render = (args: Args) =>
	defineAureliaStory({
		template: `
			${SCAFFOLD_STYLE}
			<div class="story-stage">
				<div aria-hidden="true">${args.backdrop === 'timetable' ? TIMETABLE : EMPTY}</div>
				<button type="button" class="[ story-replay ] [ button ] [ pressable ]" data-variant="outlined" click.trigger="replay()">
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

/** The motion that matches the viewer's preference. */
async function expectMotion(canvasElement: HTMLElement, confetti: boolean) {
	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
	const headline = canvasElement.querySelector('.celebration-text')
	if (!headline) throw new Error('no headline')
	const pieces = canvasElement.querySelectorAll('.confetti')
	if (reduced) {
		await expect(getComputedStyle(headline).animationName).toBe('none')
		await expect(pieces).toHaveLength(0)
	} else {
		await expect(getComputedStyle(headline).animationName).toBe(
			'headline-enter',
		)
		await expect(pieces.length > 0).toBe(confetti)
	}
}

/** Post-signup over the Dashboard empty state: dark, blurred scrim. */
export const PostSignupOverEmptyState = {
	tags: ['reduced-motion'],
	render,
	args: { tier: 'postSignup', backdrop: 'empty' },
	play: async ({ canvasElement }) => {
		const overlay = await expectLines(canvasElement, [t.welcome, t.chasing])
		const style = getComputedStyle(overlay)
		await expect(style.backdropFilter).toContain('blur')
		await expectMotion(canvasElement, true)
	},
} satisfies Story

/** Post-signup over a full timetable. */
export const PostSignupOverTimetable = {
	render,
	args: { tier: 'postSignup', backdrop: 'timetable' },
	play: async ({ canvasElement }) => {
		await expectLines(canvasElement, [t.welcome, t.chasing])
	},
} satisfies Story

/** The onboarding payoff over a full timetable: three lines, no confetti. */
export const LightOverTimetable = {
	tags: ['reduced-motion'],
	render,
	args: { tier: 'light', backdrop: 'timetable' },
	play: async ({ canvasElement }) => {
		await expectLines(canvasElement, [
			t.complete,
			'5組のアーティストの12公演が見つかりました',
			t.tapToView,
		])
		await expectMotion(canvasElement, false)
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
