import { WelcomeRoute } from './welcome-route'

/**
 * Storybook for the Welcome (landing) route.
 *
 * No RPC mocks are wired into Storybook so the component cannot fetch preview
 * data. Both stories therefore render the no-preview fallback state:
 *   - Screen 1: brand / title / subtitle / language switcher / inline CTAs
 *   - No guided demo — the hero fallback shows inline CTAs instead
 *
 * To preview the full guided demo (notification → morph → interactive timetable
 * → detail sheet), run the application against a real or stubbed backend where
 * `ConcertService/ListByArtists` returns concerts for the configured preview
 * artists (locally: `/welcome?devPreview=1`).
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

/** No preview data — shows hero with inline CTA fallback. */
export const Default = {}

/** Same as Default; the data-absent state is the only Storybook-reachable state
 *  without a live backend. Named explicitly for clarity in the story panel. */
export const NoPreviewFallback = {}
