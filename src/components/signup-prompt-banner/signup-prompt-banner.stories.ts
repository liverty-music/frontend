import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import {
	expectBannerMessage,
	expectBannerMotion,
	expectBannerOffset,
	expectBannerSurface,
	expectCompactFilledButton,
	expectOneRow,
} from '../../../.storybook/bottom-banner'
import ja from '../../locales/ja/translation.json'
import { SignupPromptBanner } from './signup-prompt-banner'

const meta = {
	title: 'Components/SignupPromptBanner',
	component: SignupPromptBanner,
	tags: ['test', 'autodocs'],
	argTypes: {
		message: { control: 'text' },
		visible: { control: 'boolean' },
	},
} satisfies Meta<typeof SignupPromptBanner>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A guest's banner on My Artists. Tagged `reduced-motion`, so it also runs with
 * motion reduced and asserts the motion that matches the preference.
 */
export const Visible = {
	tags: ['reduced-motion'],
	args: {
		visible: true,
		message: ja.myArtists.signupBanner.message,
	},
	render: (args) =>
		defineAureliaStory({
			template: `<signup-prompt-banner visible.bind="visible" message.bind="message"></signup-prompt-banner>`,
			props: args,
			register: [SignupPromptBanner],
		}),
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement)
		const host = canvasElement.querySelector<HTMLElement>(
			'signup-prompt-banner',
		)
		const surface = canvasElement.querySelector<HTMLElement>('.signup-banner')
		const message = canvasElement.querySelector<HTMLElement>(
			'.signup-banner-message',
		)
		if (!host || !surface || !message) throw new Error('no banner')
		const action = canvas.getByRole('button', { name: ja.signupBanner.cta })

		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "Component renders consistently"
		await expect(message.textContent).toBe(args.message)
		await expect(getComputedStyle(host).position).toBe('fixed')
		await expectBannerOffset(host)

		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "No dismiss control"
		await expect(canvas.getAllByRole('button')).toEqual([action])
		await expectOneRow(surface, message, action)

		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "Banner has frosted glass background"
		await expectBannerSurface(surface)

		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "Sign Up button is the filled compact button"
		// @spec components/infrastructure/fan/web/global/ui-primitives "Compact filled button on a bottom banner"
		await expectCompactFilledButton(action, message)

		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "Banner message text"
		await expectBannerMessage(message, surface)

		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "CTA attention cue"
		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "CTA button has no animation for reduced motion"
		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "Banner slides in on appearance"
		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "Banner appears instantly for reduced motion"
		await expectBannerMotion(surface, action)
	},
} satisfies Story
