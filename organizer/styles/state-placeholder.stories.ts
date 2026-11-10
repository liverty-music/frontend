import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { expectScreenshot } from '../../.storybook/screenshot'
import { consoleStoryParameters } from '../ui/story-support'

// The empty or error state both apps share (`shared/styles/state-placeholder.css`)
// with the console's tokens, as a console screen draws it: a screen with
// nothing to list (a title and a message) and a failed load (a message and a
// retry). One centred column, the title `on-surface`, the message
// `on-surface-variant`.
const meta = {
	title: 'Console/Foundations/StatePlaceholder',
	parameters: consoleStoryParameters,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** The computed colour of `name` for a probe inside `root`. */
function role(root: HTMLElement, name: string): string {
	const probe = document.createElement('span')
	probe.style.color = `var(${name})`
	root.append(probe)
	const color = getComputedStyle(probe).color
	probe.remove()
	return color
}

/** Nothing to list: a title and a message. */
export const Empty = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="inline-size:600px; padding:24px; background:var(--md-sys-color-surface)">
					<div class="[ state-placeholder ]" data-testid="empty">
						<p class="[ state-placeholder-title ] [ md-typescale-title-medium ]">\${'concerts.noArtist' & t}</p>
						<p>\${'concerts.noArtistBody' & t}</p>
					</div>
				</div>`,
		}),
	play: async ({ canvasElement }) => {
		const block = canvasElement.querySelector<HTMLElement>('.state-placeholder')
		if (!block) throw new Error('no state-placeholder')
		const [title, body] = [...block.querySelectorAll('p')]
		await expect(getComputedStyle(title).color).toBe(
			role(block, '--md-sys-color-on-surface'),
		)
		await expect(getComputedStyle(body).color).toBe(
			role(block, '--md-sys-color-on-surface-variant'),
		)
		await expect(getComputedStyle(block).textAlign).toBe('center')
		await expect(getComputedStyle(block).justifyItems).toBe('center')
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'console-state-placeholder-empty',
		)
	},
} satisfies Story

/** A failed load: the message and a retry, the button centred below it. */
export const LoadFailed = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="inline-size:600px; padding:24px; background:var(--md-sys-color-surface)">
					<div class="[ state-placeholder ]" role="alert">
						<p>\${'concerts.loadFailed' & t}</p>
						<console-button variant="tonal">\${'common.retry' & t}</console-button>
					</div>
				</div>`,
		}),
	play: async ({ canvasElement }) => {
		const block = canvasElement.querySelector<HTMLElement>('.state-placeholder')
		if (!block) throw new Error('no state-placeholder')
		const message = block.querySelector('p') as HTMLElement
		const button = block.querySelector('console-button') as HTMLElement
		const m = message.getBoundingClientRect()
		const b = button.getBoundingClientRect()
		await expect(b.top).toBeGreaterThanOrEqual(m.bottom)
		// Both centred on the block's axis.
		const axis = block.getBoundingClientRect()
		const centre = axis.left + axis.width / 2
		await expect(Math.abs(m.left + m.width / 2 - centre)).toBeLessThan(1)
		await expect(Math.abs(b.left + b.width / 2 - centre)).toBeLessThan(1)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'console-state-placeholder-error',
		)
	},
} satisfies Story
