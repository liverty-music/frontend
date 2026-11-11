import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent } from 'storybook/test'
import { composite, contrast, WCAG_AA } from '../../.storybook/contrast'
import { expectScreenshot } from '../../.storybook/screenshot'

/**
 * Foundations story for the shared text link (`src/styles/text-link.css`):
 * one colour role for every link, always underlined. Inline links take the
 * type of their sentence; a standalone link grows its box to the 48px target
 * and keeps its text size. axe runs on each story.
 */
const meta = {
	title: 'Foundations/Text link',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Links on the page surface and on a panel, the two places they sit. */
function surfaces(content: string): string {
	return `
		<div style="inline-size:20rem; box-sizing:border-box">
			<div class="[ flow ]" style="padding:1rem; background:var(--md-sys-color-surface)">${content}</div>
			<div class="[ flow ]" style="padding:1rem; background:var(--md-sys-color-surface-container-high)">${content}</div>
		</div>`
}

function links(canvasElement: HTMLElement): HTMLElement[] {
	return Array.from(canvasElement.querySelectorAll<HTMLElement>('.text-link'))
}

/** The role colour, the underline, and contrast on the surface behind. */
async function expectLink(el: HTMLElement): Promise<void> {
	const probe = document.createElement('span')
	probe.style.color = 'var(--md-sys-color-tertiary)'
	el.parentElement?.append(probe)
	const role = getComputedStyle(probe).color
	probe.remove()
	const style = getComputedStyle(el)
	await expect(style.color).toBe(role)
	await expect(style.textDecorationLine).toBe('underline')
	const surface = el.closest<HTMLElement>('[style*="background"]')
	if (!surface) throw new Error('no surface')
	await expect(
		contrast(
			composite(getComputedStyle(surface).backgroundColor),
			composite(style.color),
		),
	).toBeGreaterThanOrEqual(WCAG_AA)
}

export const Inline = {
	render: () =>
		defineAureliaStory({
			template: surfaces(
				`<p class="md-typescale-body-medium">利用状況の扱いは<a href="#privacy" class="text-link">プライバシーポリシー</a>に記載しています。</p>`,
			),
		}),
	play: async ({ canvasElement }) => {
		for (const el of links(canvasElement)) {
			await expectLink(el)
			// It takes the sentence's type and stays on its line.
			await expect(getComputedStyle(el).display).toBe('inline')
			await expect(getComputedStyle(el).fontSize).toBe(
				getComputedStyle(el.parentElement as HTMLElement).fontSize,
			)
		}
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'text-link-inline',
		)
	},
} satisfies Story

export const Standalone = {
	render: () =>
		defineAureliaStory({
			template: surfaces(
				`<p class="md-typescale-body-medium">お支払いは現在ご利用いただけません。</p><a href="#event" class="[ text-link ] [ md-typescale-body-medium ]" data-variant="standalone">イベントページに戻る</a>`,
			),
		}),
	play: async ({ canvasElement }) => {
		for (const el of links(canvasElement)) {
			await expectLink(el)
			// A 48px target around body-medium text (14px).
			await expect(el.getBoundingClientRect().height).toBe(48)
			await expect(getComputedStyle(el).fontSize).toBe('14px')
		}
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'text-link-standalone',
		)
	},
} satisfies Story

export const Focused = {
	render: () =>
		defineAureliaStory({
			template: surfaces(
				`<a href="#settings" class="[ text-link ] [ md-typescale-body-medium ]" data-variant="standalone">設定に戻る</a>`,
			),
		}),
	play: async ({ canvasElement }) => {
		const [first] = links(canvasElement)
		await userEvent.tab()
		await expect(first).toHaveFocus()
		await expectLink(first)
		// The app's keyboard focus ring: 3 px, 2 px outside.
		await expect(getComputedStyle(first).outlineStyle).toBe('solid')
		await expect(getComputedStyle(first).outlineWidth).toBe('3px')
		await expect(getComputedStyle(first).outlineOffset).toBe('2px')
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'text-link-focused',
		)
	},
} satisfies Story
