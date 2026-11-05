import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { SeriesSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { IConcertRpcClient } from '../../src/adapter/rpc/client/concert-client'
import { IResaleEntryRpcClient } from '../../src/adapter/rpc/client/resale-entry-client'
import type { ResaleEntry } from '../../src/entities/resale-entry'
import type { TicketStock } from '../../src/entities/ticket-sale'
import ja from '../../src/locales/ja/translation.json'
import { ResaleEntriesRoute } from '../../src/routes/resale-entries/resale-entries-route'
import { IUserStore } from '../../src/services/user-store'

const EVENT_ID = 'event-1'

const S_SEAT: TicketStock = {
	id: 'stock-s',
	eventId: EVENT_ID,
	seatTypeId: 'seat-s',
	seatTypeName: 'S席',
	price: 3000,
	state: 'soldOut',
	lowStock: false,
	resaleOpen: true,
}

const concert = {
	event: create(EventSchema, {
		id: { value: EVENT_ID },
		localDate: { value: { year: 2026, month: 11, day: 10 } },
		listedVenueName: { value: 'Zepp Haneda' },
		seriesId: { value: 's1' },
	}),
	series: create(SeriesSchema, {
		id: { value: 's1' },
		title: { value: 'ONE MAN LIVE' },
	}),
	artists: [],
}

function entry(o: Partial<ResaleEntry> = {}): ResaleEntry {
	return {
		id: 'entry-1',
		orderId: 'order-1',
		ticketStockId: S_SEAT.id,
		ticketCount: 2,
		state: 'entered',
		createTime: new Date(Date.UTC(2026, 10, 5, 1)),
		nextDrawTime: new Date(Date.UTC(2026, 10, 6, 3)),
		...o,
	}
}

/** Renders the real template with the ja bundle and the entries `list` returns. */
async function render(list: ReturnType<typeof vi.fn>, withdraw = vi.fn()) {
	const fixture = await createFixture(
		'<resale-entries-route></resale-entries-route>',
		class App {},
		[
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: 'ja',
					resources: { ja: { translation: ja } },
				}
			}),
			Registration.instance(IConcertRpcClient, {
				get: vi.fn().mockResolvedValue(concert),
			}),
			Registration.instance(IResaleEntryRpcClient, { list, withdraw }),
			Registration.instance(IUserStore, { currentLanguage: 'ja' }),
			ResaleEntriesRoute,
		],
	).started
	const host = fixture.appHost.querySelector('resale-entries-route') as Element
	const vm = CustomElement.for<ResaleEntriesRoute>(host).viewModel
	vm.loading()
	await vi.waitFor(() => expect(vm.state).toBe('ready'))
	await tasksSettled()
	return { fixture, vm }
}

function listOf(...entries: ResaleEntry[]) {
	return { entries, stocks: new Map([[S_SEAT.id, S_SEAT]]) }
}

const byTestId = (host: Element, id: string) =>
	host.querySelector(`[data-testid="${id}"]`)

/** The one rendered entry. */
const theEntry = (host: Element) =>
	byTestId(host, 'resale-entries-entry') as HTMLElement

describe('ResaleEntriesRoute (fixture)', () => {
	it('shows a lapsed entry as 期限切れ, says nothing was charged and offers to apply again', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Lapsed entry"
		const { fixture } = await render(
			vi.fn().mockResolvedValue(listOf(entry({ state: 'lapsed' }))),
		)
		const row = theEntry(fixture.appHost)

		expect(byTestId(row, 'resale-entries-event')?.textContent).toContain(
			'ONE MAN LIVE',
		)
		expect(byTestId(row, 'resale-entries-seat')?.textContent).toBe('S席 2枚')
		expect(byTestId(row, 'resale-entries-state')?.textContent).toBe('期限切れ')
		const note = byTestId(row, 'resale-entries-note')?.textContent ?? ''
		expect(note).toContain('カードの確保の期限が切れた')
		expect(note).toContain('請求はありません')
		expect(
			(
				byTestId(row, 'resale-entries-apply-again') as HTMLAnchorElement
			).getAttribute('href'),
		).toBe(`/events/${EVENT_ID}/resale/stock-s`)
		await fixture.stop(true)
	})

	it('offers no new application once the resale has closed', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Lapsed entry"
		const { fixture } = await render(
			vi.fn().mockResolvedValue({
				entries: [entry({ state: 'lapsed' })],
				stocks: new Map([[S_SEAT.id, { ...S_SEAT, resaleOpen: false }]]),
			}),
		)
		expect(
			byTestId(theEntry(fixture.appHost), 'resale-entries-apply-again'),
		).toBeNull()
		await fixture.stop(true)
	})

	it('shows a won entry as 当選 with a link to the tickets screen', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Won entry"
		const { fixture } = await render(
			vi.fn().mockResolvedValue(listOf(entry({ state: 'won' }))),
		)
		const row = theEntry(fixture.appHost)

		expect(byTestId(row, 'resale-entries-state')?.textContent).toBe('当選')
		expect(
			(
				byTestId(row, 'resale-entries-to-tickets') as HTMLAnchorElement
			).getAttribute('href'),
		).toBe('/tickets')
		await fixture.stop(true)
	})

	it('withdraws a waiting entry after the fan confirms, then offers to apply again', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Withdrawing a waiting entry"
		const withdraw = vi.fn().mockResolvedValue(
			entry({
				state: 'withdrawn',
				ticketStockId: '',
				ticketCount: 0,
				nextDrawTime: undefined,
			}),
		)
		const { fixture } = await render(
			vi.fn().mockResolvedValue(listOf(entry())),
			withdraw,
		)
		const host = fixture.appHost

		expect(byTestId(theEntry(host), 'resale-entries-state')?.textContent).toBe(
			'抽選待ち',
		)
		expect(
			byTestId(theEntry(host), 'resale-entries-next-draw')?.textContent,
		).toBe('次の抽選：2026年11月6日(金) 12:00')
		;(byTestId(host, 'resale-entries-withdraw') as HTMLButtonElement).click()
		await tasksSettled()
		expect(
			byTestId(host, 'resale-entries-withdraw-confirm')?.textContent,
		).toContain('請求はありません')
		expect(withdraw).not.toHaveBeenCalled()

		;(byTestId(host, 'resale-entries-withdraw-do') as HTMLButtonElement).click()
		await vi.waitFor(() => expect(withdraw).toHaveBeenCalledTimes(1))
		await tasksSettled()

		const row = theEntry(host)
		expect(byTestId(row, 'resale-entries-state')?.textContent).toBe(
			'取り消し済み',
		)
		expect(byTestId(row, 'resale-entries-seat')?.textContent).toBe('S席 2枚')
		expect(byTestId(row, 'resale-entries-note')?.textContent).toContain(
			'請求はありません',
		)
		expect(byTestId(row, 'resale-entries-apply-again')).not.toBeNull()
		await fixture.stop(true)
	})

	it('says the draw has already decided the entry and shows it as 当選', async () => {
		// @spec components/infrastructure/fan/web/route/resale-entry "Draw decided first"
		const list = vi
			.fn()
			.mockResolvedValueOnce(listOf(entry()))
			.mockResolvedValue(listOf(entry({ state: 'won' })))
		const withdraw = vi
			.fn()
			.mockRejectedValue(
				new ConnectError('already decided', Code.FailedPrecondition),
			)
		const { fixture, vm } = await render(list, withdraw)
		const host = fixture.appHost

		vm.askWithdraw(vm.rows[0])
		await vm.withdraw(vm.rows[0])
		await tasksSettled()

		const row = theEntry(host)
		expect(byTestId(row, 'resale-entries-state')?.textContent).toBe('当選')
		expect(byTestId(row, 'resale-entries-message')?.textContent).toBe(
			'この申し込みは、すでに抽選で結果が決まっています。',
		)
		await fixture.stop(true)
	})
})
