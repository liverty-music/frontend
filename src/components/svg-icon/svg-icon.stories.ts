import type { Meta, StoryObj } from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { SvgIcon } from './svg-icon'

// A representative slice of the icon set the switch template supports.
const ICON_NAMES = [
	'home',
	'search',
	'music',
	'ticket',
	'settings',
	'check',
	'warning',
	'info',
	'mail',
	'x-circle',
	'bell',
	'calendar',
	'map-pin',
	'lock',
	'shield-check',
] as const

const meta = {
	title: 'Components/SvgIcon',
	component: SvgIcon,
	tags: ['test', 'autodocs'],
	argTypes: {
		name: {
			control: 'select',
			options: ICON_NAMES,
			description: 'Icon key selecting which glyph the switch renders.',
		},
		size: {
			control: 'select',
			options: ['xs', 'sm', 'md', 'lg', 'xl'],
			description: 'Size preset written to the host `data-size` attribute.',
		},
	},
	args: { name: 'music', size: 'md' },
} satisfies Meta<typeof SvgIcon>

export default meta
type Story = StoryObj<typeof meta>

export const Default = {
	play: async ({ canvasElement }) => {
		// The selected glyph renders as an inline (aria-hidden) SVG.
		await expect(canvasElement.querySelector('svg')).toBeTruthy()
		// Component-level visual regression against a committed baseline
		// (design D4 / OQ2: 2% pixel tolerance absorbs sub-pixel AA jitter).
		await expectScreenshot(canvasElement, 'svg-icon-default')
	},
} satisfies Story

export const Ticket = {
	args: { name: 'ticket' },
} satisfies Story

export const Warning = {
	args: { name: 'warning' },
} satisfies Story

export const UnknownFallsBackToInfoGlyph = {
	args: { name: 'does-not-exist' },
} satisfies Story

export const ExtraLarge = {
	args: { name: 'shield-check', size: 'xl' },
} satisfies Story
