import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import {
	atEveryPhoneWidthAndLanguage,
	expectBannerMessage,
	expectBannerMotion,
	expectBannerOffset,
	expectBannerSurface,
	expectCompactFilledButton,
	expectFitsOneLine,
	expectOneRow,
} from '../../../.storybook/bottom-banner'
import en from '../../locales/en/translation.json'
import ja from '../../locales/ja/translation.json'
import { SignupPromptBanner } from './signup-prompt-banner'

const meta = {
	title: 'Components/SignupPromptBanner',
	component: SignupPromptBanner,
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
		const surface = canvasElement.querySelector<HTMLElement>(
			'signup-prompt-banner .bottom-banner',
		)
		const message = canvasElement.querySelector<HTMLElement>(
			'signup-prompt-banner .bottom-banner-message',
		)
		if (!surface || !message) throw new Error('no banner')
		const action = canvas.getByRole('button', { name: ja.signupBanner.cta })

		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "Component renders consistently"
		await expect(message.textContent).toBe(args.message)
		await expect(getComputedStyle(surface).position).toBe('fixed')
		await expectBannerOffset(surface)

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

/**
 * The prompt's one row at the phone widths in both languages: the message and
 * the button each on one line, nothing clipped, and the copy in each language.
 */
export const FitsOneLineAtEveryPhoneWidth = {
	render: () =>
		defineAureliaStory({
			template: `<signup-prompt-banner visible.bind="true" message.bind="'myArtists.signupBanner.message' | t"></signup-prompt-banner>`,
			register: [SignupPromptBanner],
		}),
	play: async ({ canvasElement }) => {
		const host = canvasElement.querySelector<HTMLElement>(
			'signup-prompt-banner',
		)
		const message = canvasElement.querySelector<HTMLElement>(
			'signup-prompt-banner .bottom-banner-message',
		)
		const action = canvasElement.querySelector<HTMLElement>(
			'signup-prompt-banner .bottom-banner-action',
		)
		if (!host || !message || !action) throw new Error('no banner')
		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "Message and button fit one line"
		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "Banner copy — Japanese"
		// @spec components/infrastructure/fan/web/global/signup-prompt-banner "Banner copy — English"
		await atEveryPhoneWidthAndLanguage(host, async (language) => {
			await expectFitsOneLine(message, action)
			await expect(message.textContent).toBe(
				language === 'en' ? 'Save your follows!' : 'フォロー履歴を保存しよう！',
			)
			await expect(action.textContent?.trim()).toBe('Sign Up')
		})
		await expect(en.myArtists.signupBanner.message).toBe('Save your follows!')
		await expect(ja.myArtists.signupBanner.message).toBe(
			'フォロー履歴を保存しよう！',
		)
	},
} satisfies Story
