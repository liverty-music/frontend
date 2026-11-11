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
})
