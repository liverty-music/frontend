import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { composite, contrast, WCAG_AA } from '../../.storybook/contrast'
import { expectScreenshot } from '../../.storybook/screenshot'

/**
 * Foundations story for the shared status label (`src/styles/status-label.css`):
 * the state of a record as a short word on a tinted container. One story per
 * tone; each checks the shape (8px corners, 4px by 12px padding, no border),
 * the tone's container and label roles, and their contrast. axe runs on each.
 */
const meta = {
	title: 'Foundations/Status label',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Labels the way the order and ticket panels show them. */
function panel(labels: string): string {
	return `
		<div style="padding:1rem; inline-size:20rem; box-sizing:border-box; background:var(--md-sys-color-surface-container)">
			<div class="[ cluster ]">${labels}</div>
		</div>`
}

const label = (text: string, tone?: string) =>
	`<output class="[ status-label ] [ md-typescale-label-large ]"${tone ? ` data-tone="${tone}"` : ''}>${text}</output>`

/** The computed value of `property` for a probe painted with `value`. */
function resolved(
	root: HTMLElement,
	property: 'backgroundColor' | 'color',
	value: string,
): string {
	const probe = document.createElement('span')
	probe.style.color = value
	probe.style.backgroundColor = value
	root.append(probe)
	const out = getComputedStyle(probe)[property]
	probe.remove()
	return out
}

/** Every label in the story has the tone's roles and the shared shape. */
async function expectTone(
	canvasElement: HTMLElement,
	container: string,
	ink: string,
): Promise<void> {
	const fill = resolved(canvasElement, 'backgroundColor', `var(${container})`)
	const text = resolved(canvasElement, 'color', `var(${ink})`)
	const labels = canvasElement.querySelectorAll<HTMLElement>('.status-label')
	await expect(labels.length).toBeGreaterThan(0)
	for (const el of labels) {
		const style = getComputedStyle(el)
		await expect(style.backgroundColor).toBe(fill)
		await expect(style.color).toBe(text)
		await expect(style.borderTopLeftRadius).toBe('8px')
		await expect(style.paddingBlockStart).toBe('4px')
		await expect(style.paddingInlineStart).toBe('12px')
		await expect(style.borderTopStyle).toBe('none')
		// label-large: 14px over a 20px line.
		await expect(style.fontSize).toBe('14px')
		await expect(el.getBoundingClientRect().height).toBe(28)
		await expect(
			contrast(composite(style.backgroundColor), composite(style.color)),
		).toBeGreaterThanOrEqual(WCAG_AA)
	}
}

export const Neutral = {
	render: () =>
		defineAureliaStory({
			template: panel(
				`${label('支払い待ち')}${label('返金済み', 'neutral')}${label('無効', 'neutral')}`,
			),
		}),
	play: async ({ canvasElement }) => {
		await expectTone(
			canvasElement,
			'--md-sys-color-surface-container-highest',
			'--md-sys-color-on-surface-variant',
		)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'status-label-neutral',
		)
	},
} satisfies Story

export const Positive = {
	render: () =>
		defineAureliaStory({
			template: panel(
				`${label('支払済み', 'positive')}${label('発券済み', 'positive')}${label('未入場', 'positive')}`,
			),
		}),
	play: async ({ canvasElement }) => {
		await expectTone(
			canvasElement,
			'--md-sys-color-primary-container',
			'--md-sys-color-on-primary-container',
		)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'status-label-positive',
		)
	},
} satisfies Story

export const ErrorTone = {
	name: 'Error',
	render: () =>
		defineAureliaStory({
			template: panel(label('無効', 'error')),
		}),
	play: async ({ canvasElement }) => {
		await expectTone(
			canvasElement,
			'--md-sys-color-error-container',
			'--md-sys-color-on-error-container',
		)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'status-label-error',
		)
	},
} satisfies Story
