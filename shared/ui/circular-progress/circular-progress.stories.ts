import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { CircularProgress } from './circular-progress'

const meta = {
	title: 'Shared/CircularProgress',
	component: CircularProgress,
	tags: ['test', 'autodocs'],
	argTypes: {
		size: {
			control: 'select',
			options: ['medium', 'small'],
			description:
				'48 px (`medium`, default) or 24 px for use inside a button.',
		},
		label: {
			control: 'text',
			description:
				'Accessible name. Empty uses the localized word for loading.',
		},
	},
	args: { size: 'medium', label: '' },
} satisfies Meta<typeof CircularProgress>

export default meta
type Story = StoryObj<typeof meta>

function arcOf(root: HTMLElement): SVGCircleElement {
	const arc = root.querySelector<SVGCircleElement>('circle.arc')
	if (!arc) throw new Error('arc not rendered')
	return arc
}

/** Rendered stroke thickness in CSS px (stroke width times the SVG scale). */
function renderedStrokeWidth(arc: SVGCircleElement): number {
	const svg = arc.ownerSVGElement
	if (!svg) throw new Error('arc outside an svg')
	const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
	return Number.parseFloat(getComputedStyle(arc).strokeWidth) * scale
}

/** The computed color a custom property resolves to in this document. */
function resolvedColor(host: HTMLElement, value: string): string {
	const probe = document.createElement('span')
	probe.style.color = value
	host.append(probe)
	const color = getComputedStyle(probe).color
	probe.remove()
	return color
}

export const Default = {
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Default rendering"
		const canvas = within(canvasElement)
		const bar = canvas.getByRole('progressbar', { name: '読み込み中' })
		await expect(bar).not.toHaveAttribute('aria-valuenow')

		const box = bar.getBoundingClientRect()
		await expect(box.width).toBe(48)
		await expect(box.height).toBe(48)

		const arc = arcOf(canvasElement)
		await expect(renderedStrokeWidth(arc)).toBeCloseTo(4, 5)
		await expect(getComputedStyle(arc).stroke).toBe(
			resolvedColor(canvasElement, 'var(--md-color-primary)'),
		)
	},
} satisfies Story

export const CustomLabel = {
	args: { label: '本人確認の結果を待っています' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByRole('progressbar', { name: '本人確認の結果を待っています' }),
		).toBeInTheDocument()
	},
} satisfies Story

/**
 * A pending button keeps its label in the layout (hidden) and draws the small
 * indicator over it, so the button does not change size.
 */
export const InsideButton = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:flex; gap:1rem; padding:1rem">
					<button type="button" data-testid="idle"
						style="display:inline-grid; place-items:center; padding:0.625rem 1.5rem; border:none; border-radius:999px; color:var(--md-color-on-primary); background:var(--md-color-primary)">
						<span style="grid-area:1/1">保存する</span>
					</button>
					<button type="button" data-testid="pending" aria-busy="true" aria-label="保存する"
						style="display:inline-grid; place-items:center; padding:0.625rem 1.5rem; border:none; border-radius:999px; color:var(--md-color-on-primary); background:var(--md-color-primary)">
						<span style="grid-area:1/1; visibility:hidden">保存する</span>
						<circular-progress size="small" style="grid-area:1/1"></circular-progress>
					</button>
				</div>
			`,
			register: [CircularProgress],
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Inside a button"
		const canvas = within(canvasElement)
		const idle = canvas.getByTestId('idle')
		const pending = canvas.getByTestId('pending')
		const bar = within(pending).getByRole('progressbar')

		const box = bar.getBoundingClientRect()
		await expect(box.width).toBe(24)
		await expect(box.height).toBe(24)

		const arc = arcOf(pending)
		await expect(renderedStrokeWidth(arc)).toBeCloseTo(3, 5)
		await expect(getComputedStyle(arc).stroke).toBe(
			getComputedStyle(pending).color,
		)

		const idleBox = idle.getBoundingClientRect()
		const pendingBox = pending.getBoundingClientRect()
		await expect(pendingBox.width).toBe(idleBox.width)
		await expect(pendingBox.height).toBe(idleBox.height)
	},
} satisfies Story

/**
 * Runs in both storybook projects: with motion the arc grows and shrinks while
 * the indicator turns about every 1.6 s; under reduced motion the arc keeps a
 * fixed length and turns once every 2 s.
 */
export const MotionFollowsSystemPreference = {
	tags: ['reduced-motion'],
	play: async ({ canvasElement, globals }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "Reduced motion"
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (import.meta.env.MODE === 'test') {
			await expect(typeof globals.reducedMotion).toBe('boolean')
			await expect(reduce).toBe(globals.reducedMotion)
		}

		const arc = arcOf(canvasElement)
		const svg = arc.ownerSVGElement
		if (!svg) throw new Error('arc outside an svg')
		const turnSeconds = Number.parseFloat(
			getComputedStyle(svg).animationDuration,
		)

		if (reduce) {
			await expect(getComputedStyle(arc).animationName).toBe('none')
			await expect(turnSeconds).toBeGreaterThanOrEqual(2)
		} else {
			await expect(getComputedStyle(arc).animationName).not.toBe('none')
			await expect(turnSeconds).toBeGreaterThan(0)
		}
	},
} satisfies Story
