import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
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
	'bell-filled',
	'calendar',
	'map-pin',
	'lock',
	'shield-check',
	'chart',
	'pointer',
	'skip-up',
	'skip-down',
] as const

const meta = {
	title: 'Components/SvgIcon',
	component: SvgIcon,
	argTypes: {
		name: {
			control: 'select',
			options: ICON_NAMES,
			description: 'Icon key selecting which glyph the switch renders.',
		},
		size: {
			control: 'select',
			options: ['sm', 'md', 'lg', 'xl'],
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

// The two consent toggles of Settings each have an icon no other row shows.
export const Chart = {
	args: { name: 'chart' },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('svg')).toBeTruthy()
	},
} satisfies Story

export const Pointer = {
	args: { name: 'pointer' },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('svg')).toBeTruthy()
	},
} satisfies Story

export const Warning = {
	args: { name: 'warning' },
} satisfies Story

export const UnknownNameRendersNothing = {
	args: { name: 'does-not-exist' },
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Icon rendering by name"
		// A missing icon is an empty slot, not a misleading glyph.
		await expect(canvasElement.querySelector('svg-icon')).toBeTruthy()
		await expect(canvasElement.querySelector('svg')).toBeNull()
	},
} satisfies Story

export const ExtraLarge = {
	args: { name: 'shield-check', size: 'xl' },
} satisfies Story

// Material 3: 24 px is the standard size of an icon that stands on its own
// (lg); 16 px is the smallest step.
const SIZE_STEPS = { sm: 16, md: 20, lg: 24, xl: 40 } as const

// Each `size` step sets the host `data-size`, and the drawn SVG takes it.
export const SizeVariants = {
	render: () =>
		defineAureliaStory({
			template: `
				<svg-icon repeat.for="step of steps" name="music" size.bind="step"></svg-icon>
			`,
			props: { steps: Object.keys(SIZE_STEPS) },
			register: [SvgIcon],
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Size variants"
		const hosts = [...canvasElement.querySelectorAll<HTMLElement>('svg-icon')]
		await expect(hosts).toHaveLength(4)
		for (const host of hosts) {
			const step = host.dataset.size as keyof typeof SIZE_STEPS
			await expect(step).toBeTruthy()
			const svg = host.querySelector('svg') as SVGSVGElement
			const rect = svg.getBoundingClientRect()
			await expect(rect.width).toBeCloseTo(SIZE_STEPS[step], 0)
			await expect(rect.height).toBeCloseTo(SIZE_STEPS[step], 0)
		}
	},
} satisfies Story

// With no `size`, an icon matches the font size of the text around it.
export const DefaultSizeFollowsText = {
	render: () =>
		defineAureliaStory({
			template: `
				<p class="text-18" style="--story-font: 18px">
					Ticket <svg-icon name="ticket"></svg-icon> ready
				</p>
				<style>.text-18 { font-size: var(--story-font); }</style>
			`,
			register: [SvgIcon],
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Default size follows the text"
		const host = canvasElement.querySelector('svg-icon') as HTMLElement
		await expect(host.dataset.size).toBeUndefined()
		const rect = (
			host.querySelector('svg') as SVGSVGElement
		).getBoundingClientRect()
		await expect(rect.width).toBeCloseTo(18, 0)
		await expect(rect.height).toBeCloseTo(18, 0)
	},
} satisfies Story

// A stylesheet can size the host directly or through `--icon-size`.
export const SizeFromStylesheet = {
	render: () =>
		defineAureliaStory({
			template: `
				<svg-icon name="check" class="host-sized"></svg-icon>
				<svg-icon name="check" class="token-sized"></svg-icon>
				<svg-icon name="check" class="host-sized" size="sm"></svg-icon>
				<style>
					.host-sized { inline-size: 3.75rem; block-size: 3.75rem; }
					.token-sized { --icon-size: 2rem; }
				</style>
			`,
			register: [SvgIcon],
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Size from a stylesheet"
		const [hostSized, tokenSized, overStep] = [
			...canvasElement.querySelectorAll('svg-icon svg'),
		].map((svg) => svg.getBoundingClientRect().width)
		await expect(hostSized).toBeCloseTo(60, 0)
		await expect(tokenSized).toBeCloseTo(32, 0)
		// A host size written by a stylesheet wins over a `size` step.
		await expect(overStep).toBeCloseTo(60, 0)
	},
} satisfies Story

// The required icon set from the ui-primitives spec.
const REQUIRED_ICONS = [
	'home',
	'search',
	'discovery',
	'music',
	'my-artists',
	'ticket',
	'settings',
	'check',
	'alert-triangle',
	'warning',
	'info',
	'x-circle',
	'x',
	'chevron-right',
	'chevron-left',
	'arrow-left',
	'trash',
	'plus',
	'map-pin',
	'calendar',
	'link',
	'clock',
	'globe',
	'bell',
	'lock',
	'mail',
	'qr-code',
	'list',
	'grid',
] as const

export const IconSetCoverage = {
	render: () =>
		defineAureliaStory({
			template: `
				<svg-icon repeat.for="name of names" name.bind="name" size="md" data-name.bind="name"></svg-icon>
			`,
			props: { names: REQUIRED_ICONS },
			register: [SvgIcon],
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Icon set coverage"
		const missing = [...canvasElement.querySelectorAll<HTMLElement>('svg-icon')]
			.filter((host) => !host.querySelector('svg'))
			.map((host) => host.dataset.name)
		await expect(missing).toEqual([])
		// An outline icon (`fill="none"`) is drawn as an outline: no global
		// fill paints it into a solid shape.
		const filledOutlines = [
			...canvasElement.querySelectorAll<SVGElement>('svg[fill="none"]'),
		]
			.filter((svg) => getComputedStyle(svg).fill !== 'none')
			.map((svg) => svg.closest<HTMLElement>('svg-icon')?.dataset.name)
		await expect(filledOutlines).toEqual([])
	},
} satisfies Story

// Stroke icons inherit the container's text color through currentColor;
// fill-based ones (warning, x-circle) fill with it.
export const ColorInheritance = {
	render: () =>
		defineAureliaStory({
			template: `
				<p class="tinted">
					<svg-icon name="check" size="md"></svg-icon>
					<svg-icon name="warning" size="md"></svg-icon>
					<svg-icon name="x-circle" size="md"></svg-icon>
				</p>
				<style>.tinted { color: rgb(255, 0, 0); }</style>
			`,
			register: [SvgIcon],
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Color inheritance"
		const [check, warning, xCircle] = [
			...canvasElement.querySelectorAll('svg-icon svg'),
		]
		await expect(check.getAttribute('stroke')).toBe('currentColor')
		await expect(getComputedStyle(check).stroke).toBe('rgb(255, 0, 0)')
		for (const svg of [warning, xCircle]) {
			await expect(
				svg.querySelector('[fill="currentColor"], [fill="currentcolor"]') ??
					svg.getAttribute('fill'),
			).toBeTruthy()
			await expect(getComputedStyle(svg).color).toBe('rgb(255, 0, 0)')
		}
	},
} satisfies Story

// The timetable's month-jump buttons: previous month (up) and next month
// (down).
export const SkipUp = {
	args: { name: 'skip-up' },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('svg polygon')).toBeTruthy()
		await expect(canvasElement.querySelector('svg line')).toBeTruthy()
	},
} satisfies Story

export const SkipDown = {
	args: { name: 'skip-down' },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('svg polygon')).toBeTruthy()
		await expect(canvasElement.querySelector('svg line')).toBeTruthy()
	},
} satisfies Story
