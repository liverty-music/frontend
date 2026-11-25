import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement } from 'aurelia'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
	finishMotion,
	nextPaint,
	pausableAnimations,
	seekMotion,
} from '../../../.storybook/motion'
import { transitionsEnded } from '../../../.storybook/transitions-ended'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import ja from '../../locales/ja/translation.json'
import { HomeAreaSelector } from './home-area-selector'

const meta = {
	title: 'Components/HomeAreaSelector',
	component: HomeAreaSelector,
	globals: { viewport: { value: 'mobile2', isRotated: false } },
} satisfies Meta<typeof HomeAreaSelector>

export default meta
type Story = StoryObj<typeof meta>

const chosen = fn(async (_code: string) => {})

/** The selector in its bottom sheet, closed until a story opens it. */
const render: Story['render'] = () =>
	defineAureliaStory({
		template: `<home-area-selector current-code.bind="'JP-13'" on-home-selected.bind="chosen"></home-area-selector>`,
		props: { chosen },
		register: [HomeAreaSelector, BusyOnClickCustomAttribute],
	})

const selectorOf = (root: HTMLElement) =>
	CustomElement.for<HomeAreaSelector>(
		root.querySelector('home-area-selector') as Element,
	).viewModel

const popoverOf = (root: HTMLElement) =>
	root.querySelector<HTMLElement>('.sheet-popover') as HTMLElement

async function opened(root: HTMLElement): Promise<HTMLElement> {
	selectorOf(root).open()
	const popover = popoverOf(root)
	await waitFor(() => expect(popover.matches(':popover-open')).toBe(true))
	await transitionsEnded(root)
	return popover
}

const labels = (root: HTMLElement) =>
	[...root.querySelectorAll('.selector-option')].map((b) =>
		b.textContent?.trim(),
	)

/**
 * The selector opens in the Top Layer above the page, with no z-index of its
 * own. Step 1 offers the six major cities and the eight regions; a region
 * leads to its prefectures.
 */
export const OpensInTheTopLayer = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/home-area-selector "Opening home area selector"
		const popover = await opened(canvasElement)
		// The Top Layer, not a stacking order: a fixed full-viewport popover.
		await expect(getComputedStyle(popover).position).toBe('fixed')
		await expect(getComputedStyle(popover).zIndex).toBe('auto')
		const c = ja.homeAreaSelector.cities
		const cities = [c.tokyo, c.osaka, c.nagoya, c.fukuoka, c.sapporo, c.sendai]
		await expect(labels(canvasElement)).toEqual(expect.arrayContaining(cities))
		const regions = [...canvasElement.querySelectorAll('.selector-option')]
			.map((b) => b.textContent?.trim() ?? '')
			.filter((t) => !cities.includes(t))
		await expect(regions).toHaveLength(8)

		await userEvent.click(
			within(canvasElement).getByRole('button', { name: regions[2] }),
		)
		await waitFor(() =>
			expect(labels(canvasElement)).toContain(
				ja.homeAreaSelector.prefectures.tokyo,
			),
		)
	},
} satisfies Story

/**
 * The dimmed area behind the sheet is dark, translucent and blurred; tapping
 * it closes the sheet, and so does Escape.
 */
export const BackdropAndDismiss = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/home-area-selector "Dialog backdrop and dismiss"
		const popover = await opened(canvasElement)
		const backdrop = getComputedStyle(popover, '::backdrop')
		await expect(backdrop.backdropFilter).toContain('blur')
		const [r, g, b, a = 1] = backdrop.backgroundColor
			.match(/[\d.]+/g)
			?.map(Number) ?? [255, 255, 255, 1]
		await expect(Math.max(r, g, b)).toBeLessThan(40)
		await expect(a).toBeGreaterThan(0.3)
		await expect(a).toBeLessThan(1)

		canvasElement.querySelector<HTMLElement>('.dismiss-zone')?.click()
		await waitFor(() => expect(popover.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})

		await opened(canvasElement)
		await userEvent.keyboard('{Escape}')
		await waitFor(() => expect(popover.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})
	},
} satisfies Story

/**
 * Choosing a city hands its code to the caller and closes the sheet.
 */
export const ChoosingACityClosesTheSheet = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/home-area-selector "Changing home area"
		chosen.mockClear()
		const popover = await opened(canvasElement)
		await userEvent.click(
			within(canvasElement).getByRole('button', {
				name: ja.homeAreaSelector.cities.osaka,
			}),
		)
		await waitFor(() => expect(chosen).toHaveBeenCalledWith('JP-27'))
		await waitFor(() => expect(popover.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})
	},
} satisfies Story

/**
 * The sheet slides up from the bottom of the viewport as every bottom sheet
 * does (its own story steps through it); under reduced motion it stays in
 * place and fades in over at most 100 ms. Closing is the dismiss scroll.
 */
export const OpeningMotion = {
	tags: ['reduced-motion'],
	render,
	play: async ({ canvasElement }) => {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		// @spec components/infrastructure/fan/web/global/home-area-selector "Dialog open/close animation"
		await opened(canvasElement)
		const body = canvasElement.querySelector('.sheet-body') as HTMLElement
		const rest = body.getBoundingClientRect().top
		body.style.animation = 'none'
		void body.offsetHeight
		body.style.animation = ''
		await nextPaint()
		const motion = pausableAnimations(canvasElement).filter(
			(a) =>
				(a as CSSAnimation).animationName ===
				(reduced ? 'sheet-fade' : 'sheet-rise'),
		)
		await expect(motion).toHaveLength(1)
		await seekMotion(motion, 0)
		if (reduced) {
			await expect(
				Number(motion[0].effect?.getComputedTiming().duration),
			).toBeLessThanOrEqual(100)
			await expect(body.getBoundingClientRect().top).toBeCloseTo(rest, 0)
			await expect(
				Number.parseFloat(getComputedStyle(body).opacity),
			).toBeLessThan(0.1)
		} else {
			// It starts below the bottom edge and rises to its place.
			await expect(body.getBoundingClientRect().top).toBeGreaterThanOrEqual(
				innerHeight - 1,
			)
		}
		finishMotion(motion)
		await expect(body.getBoundingClientRect().top).toBeCloseTo(rest, 0)
	},
} satisfies Story
