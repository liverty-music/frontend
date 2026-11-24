import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import { atRest, inSettingsCard } from '../settings-list/settings-card-frame'
import { SettingsSwitchRow } from './settings-switch-row'

const meta = {
	title: 'Components/SettingsSwitchRow',
	component: SettingsSwitchRow,
	argTypes: {
		icon: { control: 'text' },
		label: { control: 'text' },
		description: {
			control: 'text',
			description: 'Shown under the label and referenced by the switch.',
		},
		checked: { control: 'boolean' },
		unavailable: {
			control: 'boolean',
			description: 'Kept focusable (aria-disabled), dimmed.',
		},
	},
	args: {
		icon: 'music',
		label: '効果音',
		description: '',
		descriptionId: 'switch-row-desc',
		checked: true,
		unavailable: false,
	},
} satisfies Meta<typeof SettingsSwitchRow>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: inSettingsCard(
			'<settings-switch-row icon.bind="icon" label.bind="label" description.bind="description" description-id.bind="descriptionId" checked.bind="checked" unavailable.bind="unavailable" action.bind="action"></settings-switch-row>',
		),
		props: args,
		register: [SettingsSwitchRow, BusyOnClickCustomAttribute],
	})

/** On: the whole row is the switch, and tapping it runs the action. */
export const On = {
	args: { action: fn() },
	render,
	play: async ({ canvasElement, args }) => {
		const sw = within(canvasElement).getByRole('switch', { name: /効果音/ })
		await expect(sw).toHaveAttribute('aria-checked', 'true')
		await userEvent.click(sw)
		await expect(args.action).toHaveBeenCalledOnce()
		await atRest(userEvent, canvasElement)
		await expectScreenshot(canvasElement, 'settings-switch-row-on')
	},
} satisfies Story

export const Off = {
	args: { checked: false },
	render,
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole('switch')).toHaveAttribute(
			'aria-checked',
			'false',
		)
		await expectScreenshot(canvasElement, 'settings-switch-row-off')
	},
} satisfies Story

/** With a description, which the switch references. */
export const WithDescription = {
	tags: ['japanese'],
	args: {
		icon: 'swap',
		label: '左利きモード',
		description: 'メニューボタンが左手で操作しやすい位置に開きます。',
	},
	render,
	play: async ({ canvasElement }) => {
		const sw = within(canvasElement).getByRole('switch', {
			name: /左利きモード/,
		})
		await expect(sw).toHaveAttribute('aria-describedby', 'switch-row-desc')
		await expect(
			canvasElement.querySelector('#switch-row-desc'),
		).toHaveTextContent('メニューボタン')
		await expectScreenshot(
			canvasElement,
			'settings-switch-row-with-description',
		)
	},
} satisfies Story

/** Unavailable: still in the accessibility tree, dimmed, with the reason. */
export const Unavailable = {
	args: {
		icon: 'bell',
		label: 'プッシュ通知',
		description: 'この環境では利用できません',
		checked: false,
		unavailable: true,
	},
	render,
	play: async ({ canvasElement }) => {
		const sw = within(canvasElement).getByRole('switch', {
			name: /プッシュ通知/,
		})
		await expect(sw).toHaveAttribute('aria-disabled', 'true')
		await expect(sw).not.toBeDisabled()
		await expect(sw).toHaveAttribute('aria-describedby', 'switch-row-desc')
		await expectScreenshot(canvasElement, 'settings-switch-row-unavailable')
	},
} satisfies Story

const size = (el: Element) => {
	const box = el.getBoundingClientRect()
	return { width: Math.round(box.width), height: Math.round(box.height) }
}

/** The track and handle of the switch in a story. */
const parts = (canvasElement: HTMLElement) => {
	const track = canvasElement.querySelector('.settings-toggle-track')
	const thumb = canvasElement.querySelector('.settings-toggle-thumb')
	if (!track || !thumb) throw new Error('no switch in the story')
	return { track, thumb }
}

// @spec components/infrastructure/fan/web/route/settings "Switch is turned on"
/** On: a 52 x 32 px track whose 24 px handle sits inside it at the on end. */
export const OnGeometry = {
	args: { checked: true },
	render,
	play: async ({ canvasElement }) => {
		const { track, thumb } = parts(canvasElement)
		await waitFor(() => expect(size(thumb)).toEqual({ width: 24, height: 24 }))
		await expect(size(track)).toEqual({ width: 52, height: 32 })
		const t = track.getBoundingClientRect()
		const h = thumb.getBoundingClientRect()
		await expect(h.right).toBeLessThanOrEqual(t.right)
		await expect(h.left).toBeGreaterThanOrEqual(t.left)
		// Centred on the on end, 36 px from the track's start edge.
		await expect(Math.round(h.left + h.width / 2 - t.left)).toBe(36)
	},
} satisfies Story

/** Off: the handle is 16 px, centred 16 px from the start edge. */
export const OffGeometry = {
	args: { checked: false },
	render,
	play: async ({ canvasElement }) => {
		const { track, thumb } = parts(canvasElement)
		await waitFor(() => expect(size(thumb)).toEqual({ width: 16, height: 16 }))
		const t = track.getBoundingClientRect()
		const h = thumb.getBoundingClientRect()
		await expect(Math.round(h.left + h.width / 2 - t.left)).toBe(16)
	},
} satisfies Story

// @spec components/infrastructure/fan/web/route/settings "Reduced motion"
/** Reduced motion: the handle is at the on end at once, with no transition. */
export const ReducedMotion = {
	tags: ['reduced-motion'],
	args: { checked: true },
	render,
	play: async ({ canvasElement }) => {
		const { thumb } = parts(canvasElement)
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		const duration = getComputedStyle(thumb).transitionDuration
		if (reduced) {
			await expect(duration.split(',').every((d) => d.trim() === '0s')).toBe(
				true,
			)
		}
		await waitFor(() => expect(size(thumb)).toEqual({ width: 24, height: 24 }))
	},
} satisfies Story
