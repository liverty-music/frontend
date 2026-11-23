import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { findOverflow } from '../../.storybook/fits-screen'

/**
 * Foundations story for the check every story passes after it has run
 * (`.storybook/fits-screen.ts`: nothing is cut off or past the screen's
 * edge). A check that cannot fail protects nothing, so this story renders text
 * that runs past the screen, text a box cuts off, text that scrolls on purpose
 * and text shortened with an ellipsis, and asserts the check reports the first
 * two and only those. It shows overflowing text on purpose, so it opts out of
 * the check it tests.
 */
const meta = {
	title: 'Foundations/FitsScreen',
	// A phone, so the 36 px line is wider than the screen.
	globals: { viewport: { value: 'mobile1', isRotated: false } },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const ROWS = `
	<p style="margin:0; white-space:nowrap; font-size:36px">A: runs past the screen, runs past the screen</p>
	<div style="overflow:hidden; inline-size:120px">
		<p style="margin:0; white-space:nowrap">C: a box cuts this off, a box cuts this off</p>
	</div>
	<div tabindex="0" aria-label="B: a row that scrolls" style="overflow-x:auto; inline-size:200px">
		<p style="margin:0; white-space:nowrap">B: scrolls on purpose, scrolls on purpose</p>
	</div>
	<div style="overflow:hidden; inline-size:120px">
		<p style="margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">D: an ellipsis on purpose, an ellipsis</p>
	</div>
`

/** What the check reports for text that runs past or is cut off, and what it leaves. */
export const ReportsOnlyWhatIsCutOff = {
	parameters: {
		fitsScreen: {
			disable:
				'shows text past the screen and cut off on purpose, to test the check',
		},
	},
	render: () => defineAureliaStory({ template: `<div>${ROWS}</div>` }),
	play: async () => {
		const found = findOverflow().join('\n')
		await expect(found).toContain('"A: runs past the s')
		await expect(found).toContain('"C: a box cuts this')
		await expect(found).not.toContain('"B: scrolls')
		await expect(found).not.toContain('"D: an ellipsis')
	},
} satisfies Story

/** Text that fits the screen is not reported. */
export const FindsNothingInATextThatFits = {
	render: () =>
		defineAureliaStory({
			template: '<p>The text fits the screen, and wraps where it must.</p>',
		}),
	play: async () => {
		await expect(findOverflow()).toEqual([])
	},
} satisfies Story
