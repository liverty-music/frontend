import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { bindable, CustomElement, Registration, resolve } from 'aurelia'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { GuideTargetCustomAttribute } from '../../custom-attributes/guide-target'
import { IAnalyticsService } from '../../lib/analytics/analytics-service'
import { IAuthService } from '../../services/auth-service'
import { type GuideMoment, IGuideService } from '../../services/guide-service'
import { IOnboardingService } from '../../services/onboarding-service'
import { GuideLine } from './guide-line'

/** Shows `moment` once attached, as a screen does when its condition holds. */
class GuideStoryDriver {
	@bindable public moment: GuideMoment = 'discovery.swap'
	private readonly guide = resolve(IGuideService)

	public attached(): void {
		// replay() ignores the seen mark a previous story run left on the device.
		this.guide.replay(this.moment)
	}

	public detaching(): void {
		this.guide.dismiss(this.moment, 'route_leave')
	}
}
const Driver = CustomElement.define(
	{ name: 'guide-story-driver', template: '', bindables: ['moment'] },
	GuideStoryDriver,
)

const meta = {
	title: 'Components/GuideLine',
	component: GuideLine,
} satisfies Meta<typeof GuideLine>

export default meta
type Story = StoryObj<typeof meta>

const items = [
	Registration.instance(IAuthService, { isAuthenticated: false }),
	Registration.instance(IOnboardingService, { isOnboarding: true }),
	Registration.instance(IAnalyticsService, {
		capture() {},
		identify() {},
		reset() {},
		getFeatureFlag: (_k: string, d: unknown) => d,
		captureException: () => false,
		addExceptionStep() {},
	}),
]

/**
 * A page with a target, a control elsewhere and a counter of taps each one
 * received, so a play function can show both still work under the moment.
 */
function render(target: string, moment: GuideMoment): Story['render'] {
	return () =>
		defineAureliaStory({
			template: `
			<div lang="ja" class="stack" style="--stack-space: 24px; padding: 120px 16px 16px;">
				${target}
				<button type="button" data-testid="elsewhere" click.trigger="otherTaps++">ページのボタン</button>
				<p data-testid="counts">target \${targetTaps} / elsewhere \${otherTaps}</p>
				<guide-line></guide-line>
				<guide-story-driver moment="${moment}"></guide-story-driver>
			</div>`,
			props: {
				targetTaps: 0,
				otherTaps: 0,
				useTarget(this: { targetTaps: number }) {
					this.targetTaps++
				},
			},
			register: [GuideLine, GuideTargetCustomAttribute, Driver],
			items,
		})
}

const BUTTON_TARGET = `
	<button type="button" data-testid="target" guide-target="discovery.swap"
		click.trigger="useTarget()" style="inline-size: 64px; block-size: 64px; align-self: end;">
		ライブ
	</button>`

const FIELD_TARGET = `
	<div data-testid="target" guide-target="value: discovery.follow; shape: inset"
		click.trigger="useTarget()"
		style="block-size: 360px; border-radius: 16px; background: var(--md-sys-color-surface-container);">
	</div>`

async function shownLine(canvasElement: HTMLElement): Promise<HTMLElement> {
	return waitFor(() => {
		const line = canvasElement.querySelector<HTMLElement>('.guide-line')
		if (!line?.matches(':popover-open') || !line.textContent?.trim()) {
			throw new Error('guide line not shown yet')
		}
		return line
	})
}

/**
 * A button target: it glows, the line is a status message next to it, and a
 * tap on it performs its own action and ends the moment.
 */
export const ButtonTarget: Story = {
	render: render(BUTTON_TARGET, 'discovery.swap'),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const target = canvas.getByTestId('target')
		const line = await shownLine(canvasElement)

		// @spec components/infrastructure/fan/web/global/guide-moment "Screen reader"
		// An <output>: a status message, announced once its text is set.
		expect(line).toHaveRole('status')
		// Showing it leaves focus where it was.
		expect(document.activeElement).not.toBe(line)
		expect(line).toHaveTextContent('すぐに行けるライブも見てみよう！')
		expect(target).toHaveAttribute('data-guide-active', 'ring')

		// @spec components/infrastructure/fan/web/global/guide-moment "The page stays usable"
		// No dimmed layer: the line takes no taps and nothing covers the page.
		expect(getComputedStyle(line).pointerEvents).toBe('none')

		// @spec components/infrastructure/fan/web/global/guide-moment "Tapping the target performs its action"
		await userEvent.click(target)
		expect(canvas.getByTestId('counts')).toHaveTextContent('target 1')
	},
}

/**
 * The line fades in and out over 200 ms (0 ms with motion reduced), then is
 * no longer rendered once its moment ends.
 */
export const FadesInAndOut: Story = {
	tags: ['reduced-motion'],
	render: render(BUTTON_TARGET, 'discovery.swap'),
	play: async ({ canvasElement }) => {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		const canvas = within(canvasElement)
		const line = await shownLine(canvasElement)

		// @spec components/infrastructure/fan/web/global/guide-moment "The guide line closes with a fade"
		const style = getComputedStyle(line)
		expect(style.transitionProperty).toContain('opacity')
		expect(style.transitionDuration.split(', ')[0]).toBe(
			reduce ? '0.1s' : '0.2s',
		)

		await userEvent.click(canvas.getByTestId('elsewhere'))
		await waitFor(() => expect(line.matches(':popover-open')).toBe(false))
		if (!reduce) {
			// Still painted, with its words, while it fades out: not an empty
			// capsule.
			await expect(getComputedStyle(line).display).not.toBe('none')
			await expect(line).toHaveTextContent('すぐに行けるライブも見てみよう！')
		}
		await waitFor(() => expect(getComputedStyle(line).display).toBe('none'), {
			timeout: 1000,
		})
		// The words go once it has faded, so the next moment's are set afresh.
		await waitFor(() => expect(line).toHaveTextContent(''))
	},
}

/** A tap elsewhere reaches the page and ends the moment. */
export const TapElsewhere: Story = {
	render: render(BUTTON_TARGET, 'discovery.swap'),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const target = canvas.getByTestId('target')
		const line = await shownLine(canvasElement)

		// @spec components/infrastructure/fan/web/global/guide-moment "Tap elsewhere"
		await userEvent.click(canvas.getByTestId('elsewhere'))
		expect(canvas.getByTestId('counts')).toHaveTextContent('elsewhere 1')
		await waitFor(() => expect(line.matches(':popover-open')).toBe(false))
		expect(target).not.toHaveAttribute('data-guide-active')
	},
}

/** The bubble field: its inner edge glows and the line sits inside its top edge. */
export const BubbleFieldEdge: Story = {
	render: render(FIELD_TARGET, 'discovery.follow'),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const field = canvas.getByTestId('target')
		const line = await shownLine(canvasElement)

		expect(field).toHaveAttribute('data-guide-active', 'inset')
		expect(getComputedStyle(field).boxShadow).toContain('inset')
		expect(line).toHaveTextContent(
			'気になるアーティストをタップしてフォローしよう！',
		)
		const fieldBox = field.getBoundingClientRect()
		const lineBox = line.getBoundingClientRect()
		expect(lineBox.top).toBeGreaterThanOrEqual(fieldBox.top)
		expect(lineBox.bottom).toBeLessThanOrEqual(fieldBox.bottom)
	},
}

/**
 * The glow pulses, or under a reduced-motion preference stays steady; the
 * line shows either way.
 */
export const ReducedMotion: Story = {
	tags: ['reduced-motion'],
	render: render(BUTTON_TARGET, 'discovery.swap'),
	play: async ({ canvasElement }) => {
		const target = within(canvasElement).getByTestId('target')
		const line = await shownLine(canvasElement)
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

		// @spec components/infrastructure/fan/web/global/guide-moment "Reduced motion"
		expect(line).toHaveTextContent('すぐに行けるライブも見てみよう！')
		expect(getComputedStyle(target).boxShadow).not.toBe('none')
		expect(getComputedStyle(target).animationName).toBe(
			reduce ? 'none' : 'guide-pulse',
		)
	},
}
