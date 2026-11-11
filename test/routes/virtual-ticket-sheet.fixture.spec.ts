import { I18nConfiguration } from '@aurelia/i18n'
import { createFixture } from '@aurelia/testing'
import { describe, expect, it, vi } from 'vitest'
import ja from '../../src/locales/ja/translation.json'
import { AdmissionStamp } from '../../src/routes/tickets/virtual-ticket/admission-stamp'
import { VirtualTicket } from '../../src/routes/tickets/virtual-ticket/virtual-ticket'
import type { WalletTicket } from '../../src/routes/tickets/wallet-view'

// A browser with HTML-in-Canvas: the sheet renderer is replaced, so the test
// sees only what the component does to the DOM around it.
const sheet = vi.hoisted(() => ({
	destroy: vi.fn(),
	showBack: vi.fn(),
	setLook: vi.fn(),
	tiltTo: vi.fn(),
	release: vi.fn(),
	impact: vi.fn(),
}))
// The art's renderer starts first; here it fails as it does without WebGL,
// at once rather than after loading PixiJS.
vi.mock('../../src/routes/tickets/virtual-ticket/ticket-renderer', () => ({
	TicketRenderer: {
		create: vi.fn(async () => {
			throw new Error('no WebGL')
		}),
	},
}))
vi.mock(
	'../../src/routes/tickets/virtual-ticket/ticket-sheet-renderer',
	() => ({
		sheetSupported: () => true,
		TicketSheetRenderer: { create: vi.fn(async () => sheet) },
	}),
)

const i18n = I18nConfiguration.customize((options) => {
	options.initOptions = {
		lng: 'ja',
		resources: { ja: { translation: ja } },
		fallbackLng: 'ja',
		interpolation: { escapeValue: false },
	}
})

const TICKET: WalletTicket = {
	id: 'ticket-1',
	eventId: 'event-1',
	orderId: 'order-1',
	userId: 'user-1',
	resaleWithoutConsentProhibited: true,
	state: 'not-entered',
	admitTime: null,
	seatTypeName: 'S席',
}

describe('virtual-ticket drawn as a sheet', () => {
	it('moves the card into the sheet’s canvas, and back when the ticket is closed, so it can be opened again', async () => {
		const host = { shown: true, ticket: TICKET }
		const fixture = await createFixture
			.html(
				'<virtual-ticket if.bind="shown" event.bind="null" ticket.bind="ticket"></virtual-ticket>',
			)
			.component(host)
			.deps(i18n, VirtualTicket, AdmissionStamp)
			.build().started
		const root = fixture.appHost
		const sheets = () => root.querySelectorAll('canvas.virtual-ticket-sheet')
		const card = () => root.querySelector('.virtual-ticket-card')

		// Opened: the card lies inside the one canvas, inside the fit box.
		await vi.waitFor(() => expect(sheets()).toHaveLength(1))
		expect(card()?.parentElement).toBe(sheets()[0])
		expect(sheets()[0].parentElement?.classList).toContain('virtual-ticket-fit')
		await vi.waitFor(() =>
			expect(card()?.getAttribute('data-sheeted')).toBe('true'),
		)
		const kept = card()

		// Closed: the renderer is destroyed and the DOM is as the template
		// made it, because the view is kept and attached again.
		host.shown = false
		await fixture.tasksSettled
		expect(sheet.destroy).toHaveBeenCalledTimes(1)
		expect(kept?.parentElement?.classList).toContain('virtual-ticket-fit')
		expect(kept?.querySelector('canvas.virtual-ticket-sheet')).toBeNull()
		expect(
			kept?.parentElement?.querySelector('canvas.virtual-ticket-sheet'),
		).toBeNull()

		// Opened again: one canvas, not a canvas inside the last one.
		host.shown = true
		await fixture.tasksSettled
		await vi.waitFor(() => expect(sheets()).toHaveLength(1))
		expect(card()?.parentElement).toBe(sheets()[0])
		expect(sheets()[0].parentElement?.classList).toContain('virtual-ticket-fit')
		await fixture.stop(true)
	})

	it('draws the stamp’s impact once, through the sheet, after the drawing has settled', async () => {
		sheet.impact.mockClear()
		const host = {
			ticket: { ...TICKET, state: 'entered' as const, admitTime: new Date() },
		}
		const fixture = await createFixture
			.html(
				'<virtual-ticket event.bind="null" ticket.bind="ticket" press-stamp.bind="true"></virtual-ticket>',
			)
			.component(host)
			.deps(i18n, VirtualTicket, AdmissionStamp)
			.build().started
		const root = fixture.appHost

		// The stamp waits for the sheet, then lands, and the impact follows.
		await vi.waitFor(
			() => expect(root.querySelector('[data-stamp="press"]')).not.toBeNull(),
			{ timeout: 10_000 },
		)
		await vi.waitFor(() => expect(sheet.impact).toHaveBeenCalled(), {
			timeout: 5000,
		})
		const [x, y] = sheet.impact.mock.calls[0]
		// On the stub, towards the right.
		expect(x).toBeGreaterThan(0.6)
		expect(y).toBeGreaterThan(0.8)
		expect(
			root.querySelector('.virtual-ticket-card')?.hasAttribute('data-thump'),
		).toBe(true)
		await new Promise((r) => setTimeout(r, 600))
		expect(sheet.impact).toHaveBeenCalledTimes(1)
		await fixture.stop(true)
	})
})
