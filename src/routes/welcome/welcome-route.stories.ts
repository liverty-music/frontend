import { WelcomeRoute } from './welcome-route'

const meta = {
	title: 'Pages/WelcomeRoute',
	component: WelcomeRoute,
	parameters: {
		layout: 'fullscreen',
		backgrounds: { default: 'dark' },
	},
	render: () => ({
		template: `<welcome-route></welcome-route>`,
	}),
}

export default meta

export const Default = {}
