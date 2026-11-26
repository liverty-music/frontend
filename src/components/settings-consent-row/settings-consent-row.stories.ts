import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
	finishMotion,
	nextPaint,
	pausableAnimations,
	seekMotion,
} from '../../../.storybook/motion'
import { transitionsEnded } from '../../../.storybook/transitions-ended'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import { atRest, inSettingsCard } from '../settings-list/settings-card-frame'
import { SettingsConsentRow } from './settings-consent-row'

const meta = {
	title: 'Components/SettingsConsentRow',
	component: SettingsConsentRow,
	argTypes: {
		icon: { control: 'text' },
		label: { control: 'text' },
		description: {
			control: 'text',
			description: 'Opened by tapping the label.',
		},
		checked: { control: 'boolean' },
	},
	args: {
		icon: 'info',
		label: 'アナリティクス',
		description:
			'アプリの改善のため、操作の記録を送信します。いつでもオフにできます。',
		checked: true,
	},
} satisfies Meta<typeof SettingsConsentRow>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: inSettingsCard(
			'<settings-consent-row icon.bind="icon" label.bind="label" description.bind="description" checked.bind="checked" action.bind="action"></settings-consent-row>',
		),
		props: args,
		register: [SettingsConsentRow, BusyOnClickCustomAttribute],
	})

/** Collapsed: the label is a disclosure, the switch a separate named control. */
export const Collapsed = {
	args: { action: fn() },
	render,
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement)
		const disclosure = canvas.getByRole('button', {
			name: /アナリティクス/,
			expanded: false,
		})
		const sw = canvas.getByRole('switch', { name: 'アナリティクス' })
		await expect(disclosure.contains(sw)).toBe(false)
		// Hidden, not removed, so it can animate out; not rendered meanwhile.
		const description = canvasElement.querySelector<HTMLElement>(
			'.settings-toggle-desc',
		)
		await expect(description?.hidden).toBe(true)
		await expect(getComputedStyle(description as HTMLElement).display).toBe(
			'none',
		)
		// It opens and closes with a height and opacity transition.
		const transition = getComputedStyle(description as HTMLElement)
		await expect(transition.transitionProperty).toContain('block-size')
		await expect(transition.transitionProperty).toContain('opacity')
		await userEvent.click(sw)
		await expect(args.action).toHaveBeenCalledOnce()
		await atRest(userEvent, canvasElement)
		await expectScreenshot(canvasElement, 'settings-consent-row-collapsed')
	},
} satisfies Story

/** Expanded: opening the description does not change the switch. */
export const Expanded = {
	tags: ['japanese'],
	args: { action: fn() },
	render,
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement)
		await userEvent.click(
			canvas.getByRole('button', { name: /アナリティクス/, expanded: false }),
		)
		// The description is not inside the button, so the hover and press layer
		// covers the label row only; the button points to it (aria-controls).
		const disclosure = canvas.getByRole('button', { expanded: true })
		const description = canvasElement.querySelector<HTMLElement>(
			'.settings-toggle-desc',
		) as HTMLElement
		await expect(description).toHaveTextContent('操作の記録')
		await expect(disclosure.contains(description)).toBe(false)
		await expect(disclosure.getAttribute('aria-controls')).toBe(description.id)
		// The disclosure's touch target reaches below its label row, but not over
		// the text: a tap on the first line is the text's, not a collapse.
		await transitionsEnded(canvasElement)
		const first = description.getBoundingClientRect()
		await expect(
			description.contains(
				document.elementFromPoint(first.left + 8, first.top + 6),
			),
		).toBe(true)
		await atRest(userEvent, canvasElement)
		await expect(disclosure.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			description.getBoundingClientRect().top + 1,
		)
		await expect(args.action).not.toHaveBeenCalled()
		await expect(canvas.getByRole('switch')).toHaveAttribute(
			'aria-checked',
			'true',
		)
		await atRest(userEvent, canvasElement)
		await expectScreenshot(canvasElement, 'settings-consent-row-expanded')
	},
} satisfies Story

/**
 * The description opens by growing to its height and fading in over 300 ms, and
 * closes by shrinking and fading out over 300 ms, after which it is not
 * rendered. The story steps through the opening.
 */
export const DescriptionOpensAndCloses = {
	args: { action: fn() },
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/route/settings "Opening the description"
		const canvas = within(canvasElement)
		const description = canvasElement.querySelector(
			'.settings-toggle-desc',
		) as HTMLElement
		const disclosure = canvas.getByRole('button', {
			name: /アナリティクス/,
			expanded: false,
		})
		disclosure.click()
		await nextPaint()
		const motion = (property: string) =>
			pausableAnimations(description).filter(
				(a) =>
					a instanceof CSSTransition &&
					a.transitionProperty === property &&
					a.effect?.target === description,
			)
		// Polled, not waited for by a frame: the transition is caught while it runs.
		await waitFor(() => {
			expect(motion('height')).toHaveLength(1)
			expect(motion('opacity')).toHaveLength(1)
		})
		const grow = motion('height')
		const fade = motion('opacity')
		await expect(fade).toHaveLength(1)
		for (const a of [...grow, ...fade]) {
			await expect(Number(a.effect?.getComputedTiming().duration)).toBe(300)
		}
		const opacity = () =>
			Number.parseFloat(getComputedStyle(description).opacity)
		// The 4 px of padding above the text stays; the text's own height is what grows.
		const height = () => description.getBoundingClientRect().height - 4
		await seekMotion([...grow, ...fade], 0)
		await expect(opacity()).toBeLessThan(0.1)
		await expect(height()).toBeLessThan(1)
		await seekMotion([...grow, ...fade], 0.1)
		await expect(opacity()).toBeGreaterThan(0.1)
		await expect(opacity()).toBeLessThan(1)
		await expect(height()).toBeGreaterThan(1)
		finishMotion([...grow, ...fade])
		await transitionsEnded(canvasElement)
		const full = height()
		await expect(full).toBeGreaterThan(20)
		await expect(opacity()).toBe(1)

		// Closing shrinks and fades it out the same way, then it is not rendered.
		canvas
			.getByRole('button', { name: /アナリティクス/, expanded: true })
			.click()
		await nextPaint()
		await waitFor(() => expect(motion('height')).toHaveLength(1))
		const closing = [...motion('height'), ...motion('opacity')]
		await expect(closing.length).toBeGreaterThan(0)
		await seekMotion(closing, 0.1)
		await expect(height()).toBeLessThan(full)
		await expect(opacity()).toBeLessThan(1)
		finishMotion(closing)
		await waitFor(() =>
			expect(getComputedStyle(description).display).toBe('none'),
		)
	},
} satisfies Story

export const Off = {
	args: { icon: 'lock', label: 'セッションリプレイ', checked: false },
	render,
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole('switch', { name: 'セッションリプレイ' }),
		).toHaveAttribute('aria-checked', 'false')
		await expectScreenshot(canvasElement, 'settings-consent-row-off')
	},
} satisfies Story
