import { IRouter } from '@aurelia/router'
import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement, Registration } from 'aurelia'
import { expect, userEvent, waitFor } from 'storybook/test'
import { IHistory } from '../../adapter/browser/history'
import { ILocalStorage } from '../../adapter/storage/local-storage'
import { ConcertSheet } from '../../components/concert-sheet/concert-sheet'
import { ConcertCard } from '../../components/timetable-grid/concert-card'
import { TimetableGrid } from '../../components/timetable-grid/timetable-grid'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import { GuideTargetCustomAttribute } from '../../custom-attributes/guide-target'
import { IAnalyticsService } from '../../lib/analytics/analytics-service'
import { IAuthService } from '../../services/auth-service'
import { IConcertStore } from '../../services/concert-store'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IFollowStore } from '../../services/follow-store'
import { INotificationPromptService } from '../../services/notification-prompt-service'
import { ITicketJourneyStore } from '../../services/ticket-journey-store'
import { IUserStore } from '../../services/user-store'
import { DateValueConverter } from '../../value-converters/date'
import { WelcomeRoute } from './welcome-route'

// A route story: every store and service the route resolves is a fake
// registered through `items`, so nothing reaches the network (AGENTS.md,
// "Route stories"). It renders the route's own layout, the scroll container
// the hero and the demo sit in, which no component story shows.

const items = [
	Registration.instance(IAuthService, { ready: Promise.resolve() }),
	Registration.instance(IUserStore, { currentLanguage: 'ja' }),
	Registration.instance(ILocalStorage, {}),
	Registration.instance(IFollowStore, {}),
	Registration.instance(IRouter, { load: async () => true }),
	Registration.instance(IErrorBoundaryService, {}),
	Registration.instance(IConcertStore, {}),
	Registration.instance(IAnalyticsService, { capture: () => {} }),
]

// The detail sheet opens from a card tap, which no story here makes; the
// route only holds a reference to it, so an empty element stands in.
const ConcertSheetStub = CustomElement.define(
	{ name: 'concert-sheet', template: '' },
	class {},
)

const register = [WelcomeRoute, BusyOnClickCustomAttribute, ConcertSheetStub]

const meta = {
	title: 'Routes/Welcome',
	component: WelcomeRoute,
	parameters: {
		a11y: {
			config: {
				// The route is the scroll container of the whole screen; its
				// content is reached by keyboard through the controls inside it.
				rules: [{ id: 'scrollable-region-focusable', enabled: false }],
			},
		},
	},
} satisfies Meta<typeof WelcomeRoute>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The route with its demo, on a screen as tall as the viewport (the hero and
 * the demo are one viewport each). The route shows the demo's preview data
 * when the address carries `?devPreview=1` (a development shortcut that
 * needs no backend); the story sets it before the route attaches and puts the
 * address back when it ends.
 */
const originalUrl = `${location.pathname}${location.search}`

export const RevealingThePreview = {
	tags: ['reduced-motion'],
	render: () => {
		history.replaceState(null, '', `${location.pathname}?devPreview=1`)
		return defineAureliaStory({
			template:
				'<div style="display: grid; block-size: 100svh"><welcome-route></welcome-route></div>',
			register,
			items,
		})
	},
	play: async ({ canvasElement, globals }) => {
		try {
			const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
			if (import.meta.env.MODE === 'test') {
				await expect(typeof globals.reducedMotion).toBe('boolean')
				await expect(reduce).toBe(globals.reducedMotion)
			}
			const route = canvasElement.querySelector<HTMLElement>('welcome-route')
			if (!route) throw new Error('route not rendered')
			const demo = await waitFor(() => {
				const el = route.querySelector<HTMLElement>('.welcome-demo')
				if (!el) throw new Error('demo not rendered yet')
				return el
			})
			const button = route.querySelector<HTMLElement>(
				'[data-testid="welcome-see-preview"]',
			)
			if (!button) throw new Error('scroll affordance not rendered')
			await expect(route.scrollTop).toBe(0)
			const gap = () =>
				demo.getBoundingClientRect().top - route.getBoundingClientRect().top

			// The motion is the scroll container's own: smooth by default, an
			// instant jump under reduced motion.
			await expect(getComputedStyle(route).scrollBehavior).toBe(
				reduce ? 'auto' : 'smooth',
			)

			// @spec components/infrastructure/fan/web/route/welcome "Tapping the scroll affordance reveals the preview"
			// @spec components/infrastructure/fan/web/route/welcome "Reduced motion preference disables smooth scroll"
			await userEvent.click(button)
			if (reduce) {
				// At rest at the demo within a frame.
				await new Promise(requestAnimationFrame)
				await expect(Math.abs(gap())).toBeLessThanOrEqual(1)
			} else {
				// Still on its way a frame after the tap, then at the demo.
				await new Promise(requestAnimationFrame)
				await expect(gap()).toBeGreaterThan(1)
				await waitFor(() => expect(Math.abs(gap())).toBeLessThanOrEqual(1), {
					timeout: 3000,
				})
			}
		} finally {
			history.replaceState(null, '', originalUrl)
		}
	},
} satisfies Story

/**
 * A visitor taps a card of the demo timetable: the real detail sheet opens,
 * with the official information, the venue and the calendar link, and nothing
 * that needs an account or starts sign-up.
 */
export const CardOpensTheDetailView = {
	render: () => {
		history.replaceState(null, '', `${location.pathname}?devPreview=1`)
		return defineAureliaStory({
			template:
				'<div style="display: grid; block-size: 100svh"><welcome-route></welcome-route></div>',
			register: [
				WelcomeRoute,
				BusyOnClickCustomAttribute,
				ConcertSheet,
				TimetableGrid,
				ConcertCard,
				GuideTargetCustomAttribute,
				DateValueConverter,
			],
			items: [
				...items.filter((r) => r !== items[0] && r !== items[3]),
				Registration.instance(IAuthService, {
					ready: Promise.resolve(),
					isAuthenticated: false,
				}),
				Registration.instance(IFollowStore, {
					followedIds: new Set(),
					hypeByArtist: new Map(),
				}),
				Registration.instance(ITicketJourneyStore, {
					journeyMap: new Map(),
					known: true,
					statusFor: () => undefined,
				}),
				Registration.instance(INotificationPromptService, {
					pushState: async () => 'offerable',
				}),
				Registration.instance(IHistory, {
					pushState() {},
					replaceState() {},
				}),
			],
		})
	},
	play: async ({ canvasElement }) => {
		try {
			const route = canvasElement.querySelector<HTMLElement>('welcome-route')
			if (!route) throw new Error('route not rendered')
			// The demo opens on the mock notification; its tap reveals the
			// timetable.
			const notification = await waitFor(() => {
				const el = route.querySelector<HTMLElement>(
					'[data-testid="welcome-demo-notification"] button',
				)
				if (!el) throw new Error('no notification yet')
				return el
			})
			notification.scrollIntoView()
			await userEvent.click(notification)
			const card = await waitFor(
				() => {
					const el = route.querySelector<HTMLElement>(
						'.welcome-demo-timetable [data-live-card]',
					)
					if (!el) throw new Error('no card yet')
					return el
				},
				{ timeout: 5000 },
			)
			card.scrollIntoView()
			await userEvent.click(card)
			const sheet = await waitFor(() => {
				const el = route.querySelector<HTMLElement>(
					'concert-sheet .sheet-content',
				)
				if (!el) throw new Error('detail view not open yet')
				return el
			})

			// @spec components/infrastructure/fan/web/route/welcome "Card opens the real detail view"
			await expect(sheet.querySelector('a.official-site')).not.toBeNull()
			await expect(
				sheet.querySelector('[data-testid="add-to-calendar"]'),
			).not.toBeNull()
			await expect(
				sheet.querySelector('[data-testid="journey-notify-btn"]'),
			).toBeNull()
			await expect(sheet.querySelector('[data-testid="push-line"]')).toBeNull()
			await expect(sheet.querySelector('.journey-row')).toBeNull()
			await expect(
				sheet.querySelector('[data-testid="sheet-notify-guide"]'),
			).toBeNull()
		} finally {
			history.replaceState(null, '', originalUrl)
		}
	},
} satisfies Story
