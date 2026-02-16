import { WelcomePage } from './welcome-page'

const meta = {
	title: 'Pages/WelcomePage',
	component: WelcomePage,
	parameters: {
		layout: 'fullscreen',
		backgrounds: { default: 'dark' },
	},
	render: () => ({
		template: `<welcome-page></welcome-page>`,
	}),
}

export default meta

export const Default = {}
