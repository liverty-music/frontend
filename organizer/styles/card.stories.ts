import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { expectScreenshot } from '../../.storybook/screenshot'
import { consoleStoryParameters } from '../ui/story-support'
import sharedStyles from './shared.css?inline'

/**
 * The card both apps share (`shared/styles/card.css`) with the console's
 * tokens: the centred card of the landing, access-denied and find-organizer
 * screens, as a route draws it (the page's stylesheet) and inside a console
 * component's shadow root (`shared.css`). Both check the Material 3 outlined
 * card: `surface-container` fill, a 1px `outline-variant` border, 12px corners
 * and 16px padding.
 */
const meta = {
	title: 'Console/Foundations/Card',
	parameters: consoleStoryParameters,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const CARD = `
	<section class="card" style="display:grid; gap:16px; max-inline-size:var(--card-max-inline-size)">
		<p class="md-typescale-body-medium">Liverty Music</p>
		<h1 class="md-typescale-headline-small">このアカウントでは開けません</h1>
		<p class="md-typescale-body-medium">主催者のメンバーとして招待されたアカウントでログインしてください。</p>
	</section>`

/** The computed value of `property` for a probe painted with `value`. */
function resolved(
	root: ParentNode,
	property: 'backgroundColor' | 'borderTopColor',
	value: string,
): string {
	const probe = document.createElement('span')
	probe.style.border = `1px solid ${value}`
	probe.style.backgroundColor = value
	root.append(probe)
	const out = getComputedStyle(probe)[property]
	probe.remove()
	return out
}

async function expectCard(root: ParentNode): Promise<void> {
	const el = root.querySelector<HTMLElement>('.card')
	if (!el) throw new Error('no card')
	const style = getComputedStyle(el)
	await expect(style.backgroundColor).toBe(
		resolved(root, 'backgroundColor', 'var(--md-sys-color-surface-container)'),
	)
	await expect(style.borderTopColor).toBe(
		resolved(root, 'borderTopColor', 'var(--md-sys-color-outline-variant)'),
	)
	await expect(style.borderTopWidth).toBe('1px')
	await expect(style.borderTopLeftRadius).toBe('12px')
	await expect(style.padding).toBe('16px')
	await expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(560)
}

/** On a route: the page's stylesheet (`organizer/styles/main.css`). */
export const OnARoute = {
	render: () =>
		defineAureliaStory({
			template: `<div style="padding:24px; background:var(--md-sys-color-surface)">${CARD}</div>`,
		}),
	play: async ({ canvasElement }) => {
		await expectCard(canvasElement)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'console-card',
		)
	},
} satisfies Story

/** Inside a console component's shadow root, given `shared.css`. */
export const InAShadowRoot = {
	render: () => defineAureliaStory({ template: '' }),
	play: async ({ canvasElement }) => {
		const host = document.createElement('div')
		canvasElement.append(host)
		const root = host.attachShadow({ mode: 'open' })
		const sheet = new CSSStyleSheet()
		sheet.replaceSync(sharedStyles)
		root.adoptedStyleSheets = [sheet]
		root.innerHTML = CARD
		await expectCard(root)
	},
} satisfies Story
