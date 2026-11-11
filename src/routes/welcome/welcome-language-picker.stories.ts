import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, within } from 'storybook/test'
import { WelcomeLanguagePicker } from './welcome-language-picker'

const meta = {
	title: 'Routes/Welcome/LanguagePicker',
	component: WelcomeLanguagePicker,
	argTypes: {
		current: {
			control: { type: 'inline-radio' },
			options: ['ja', 'en'],
			description: 'The language in use; its name is underlined.',
		},
	},
	args: { current: 'ja' },
} satisfies Meta<typeof WelcomeLanguagePicker>

export default meta
type Story = StoryObj<typeof meta>

/** A host that changes the language on a choice, as Welcome does. */
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<welcome-language-picker
			languages.bind="languages"
			current.bind="current"
			language-select.trigger="current = $event.detail"
		></welcome-language-picker>`,
		props: { languages: ['ja', 'en'], current: args.current },
		register: [WelcomeLanguagePicker],
	})

/** Japanese in use. */
export const Japanese = {
	render,
	args: { current: 'ja' },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole('radio', { name: '日本語' }),
		).toBeChecked()
	},
} satisfies Story

/** English in use; choosing Japanese moves the mark. */
export const English = {
	render,
	args: { current: 'en' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByRole('radio', { name: 'EN' })).toBeChecked()
		await userEvent.click(canvas.getByText('日本語'))
		await expect(canvas.getByRole('radio', { name: '日本語' })).toBeChecked()
	},
} satisfies Story
