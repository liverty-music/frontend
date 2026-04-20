import { WelcomeRoute } from './welcome-route'

/**
 * Storybook for the Welcome (landing) route.
 *
 * No RPC mocks are wired into Storybook, so the component cannot fetch preview
 * data. By default the story therefore renders the hero-only fallback state:
 *   - Screen 1: brand / title / subtitle / language switcher / inline CTAs
 *     (Get Started + Log In)
 *   - No Screen 2, no [See how it works ↓] scroll-affordance, hero sized at
 *     100svh rather than the 95svh peek configuration.
 *
 * To preview the full "Promise → Proof" composition (Screen 1 with scroll-CTA
 * and peek + Screen 2 with preview and CTAs), run the application against a
 * real or stubbed backend where `ConcertService/ListWithProximity` returns
 * concerts for the configured preview artists.
 */
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
