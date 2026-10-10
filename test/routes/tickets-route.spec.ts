import { ConcertSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	type Ticket,
	TicketSchema,
	TicketStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	decodeAdmissionCode,
	SIGN_ALGORITHM,
} from '../../shared/lib/admission-code/admission-code'
import { IScreenWakeLock } from '../../src/adapter/browser/screen-wake-lock'
import { IConcertRpcClient } from '../../src/adapter/rpc/client/concert-client'
import { ITicketRpcClient } from '../../src/adapter/rpc/client/ticket-client'
import { IWalletPublicKeyRpcClient } from '../../src/adapter/rpc/client/wallet-public-key-client'
import { IWalletStorage } from '../../src/adapter/storage/wallet-storage'
import ja from '../../src/locales/ja/translation.json'
import { TicketsRoute } from '../../src/routes/tickets/tickets-route'
import { ITicketWallet, TicketWallet } from '../../src/services/ticket-wallet'
import { IUserStore } from '../../src/services/user-store'
import { createTestContainer } from '../helpers/create-container'
import { FakeWalletStorage } from '../helpers/fake-wallet-storage'

const USER = '019a0000-0000-7000-8000-000000000001'
const EVENT = '019a0000-0000-7000-8000-0000000000e1'
const LATER_EVENT = '019a0000-0000-7000-8000-0000000000e2'
const PAST_EVENT = '019a0000-0000-7000-8000-0000000000e3'
const ticketId = (i: number) =>
	`019a0000-0000-7000-8000-${String(i).padStart(12, '0')}`

/** An instant at the given Japan-time hour on a 2026-11 day. */
function jst(day: number, hour: number, minute = 0, second = 0): Date {
	return new Date(Date.UTC(2026, 10, day, hour - 9, minute, second))
}

interface TicketOpts {
	event?: string
	status?: TicketStatus
	admitted?: Date
}

function protoTicket(i: number, o: TicketOpts = {}): Ticket {
	return create(TicketSchema, {
		id: { value: ticketId(i) },
		eventId: { value: o.event ?? EVENT },
		orderId: { value: 'order-1' },
		holderId: { value: USER },
		holderIdentity: { fullName: '山田太郎', phoneNumber: '+819012345678' },
		resaleWithoutConsentProhibited: true,
		status: o.status ?? TicketStatus.ISSUED,
		issueTime: timestampFromDate(jst(1, 10)),
		admitTime: o.admitted ? timestampFromDate(o.admitted) : undefined,
	})
}

function protoConcert(id: string, day: number) {
	return create(ConcertSchema, {
		id: { value: id },
		localDate: { value: { year: 2026, month: 11, day } },
		openTime: { value: timestampFromDate(jst(day, 17, 30)) },
		startTime: { value: timestampFromDate(jst(day, 18, 30)) },
		listedVenueName: { value: 'Shibuya WWW' },
		series: {
			id: { value: 'series-1' },
			title: { value: `LIVE ${day}` },
			organizerId: { value: 'org-1' },
			publishState: PublishState.PUBLISHED,
		},
	})
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i])
}

/** The raw public key of a key pair made on some other device. */
async function otherDeviceKey(): Promise<Uint8Array> {
	const pair = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign', 'verify'],
	)
	return new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
}

async function verifies(
	publicKey: Uint8Array,
	signature: Uint8Array,
	signed: Uint8Array,
): Promise<boolean> {
	const key = await crypto.subtle.importKey(
		'raw',
		new Uint8Array(publicKey),
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['verify'],
	)
	return crypto.subtle.verify(
		SIGN_ALGORITHM,
		key,
		new Uint8Array(signature),
		new Uint8Array(signed),
	)
}

/**
 * A pass-through bottom sheet (jsdom has no Popover API); its own behaviour is
 * covered by the bottom-sheet specs.
 */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'dismissable', 'ariaLabel'],
	},
	class {},
)

const offlineError = () => new ConnectError('Failed to fetch', Code.Unavailable)

describe('TicketsRoute', () => {
	let storage: FakeWalletStorage
	let ticketClient: { getMyTickets: ReturnType<typeof vi.fn> }
	/** The fan's WalletPublicKey on the server (null: no entry device). */
	let serverKey: Uint8Array | null
	let keyClient: {
		get: ReturnType<typeof vi.fn>
		register: ReturnType<typeof vi.fn>
	}
	let concertClient: { get: ReturnType<typeof vi.fn> }
	let wakeLock: {
		acquire: ReturnType<typeof vi.fn>
		release: ReturnType<typeof vi.fn>
	}

	/** A fresh screen on the same device (same storage). */
	function build(): TicketsRoute {
		const container = createTestContainer(
			Registration.instance(ITicketRpcClient, ticketClient),
			Registration.instance(IWalletPublicKeyRpcClient, keyClient),
			Registration.instance(IConcertRpcClient, concertClient),
			Registration.instance(IWalletStorage, storage),
			Registration.singleton(ITicketWallet, TicketWallet),
			Registration.instance(IScreenWakeLock, wakeLock),
			Registration.instance(IUserStore, { currentLanguage: 'ja' }),
		)
		container.register(TicketsRoute)
		return container.get(TicketsRoute)
	}

	async function open(): Promise<TicketsRoute> {
		const sut = build()
		sut.loading()
		await vi.waitFor(() => {
			expect(sut.step).not.toBe('loading')
			expect(sut.device).not.toBe('checking')
		})
		return sut
	}

	/** Open the screen online once so this device becomes the entry device. */
	async function prepareOnline(tickets: Ticket[]): Promise<void> {
		ticketClient.getMyTickets.mockResolvedValueOnce(tickets)
		const first = await open()
		expect(first.device).toBe('ready')
		first.detaching()
	}

	async function currentCode(sut: TicketsRoute) {
		await vi.waitFor(() => expect(sut.session.text).not.toBeNull())
		const decoded = decodeAdmissionCode(sut.session.text ?? '')
		expect(decoded).not.toBeNull()
		return decoded
	}

	beforeEach(() => {
		storage = new FakeWalletStorage()
		ticketClient = { getMyTickets: vi.fn().mockResolvedValue([]) }
		serverKey = null
		keyClient = {
			get: vi.fn(async () => serverKey),
			register: vi.fn(async (key: Uint8Array) => {
				const replacedOtherKey =
					serverKey !== null && !sameBytes(serverKey, key)
				serverKey = new Uint8Array(key)
				return { replacedOtherKey }
			}),
		}
		concertClient = {
			get: vi.fn(async (id: string) =>
				protoConcert(id, id === EVENT ? 20 : id === LATER_EVENT ? 27 : 1),
			),
		}
		wakeLock = {
			acquire: vi.fn().mockResolvedValue(undefined),
			release: vi.fn().mockResolvedValue(undefined),
		}
		vi.useFakeTimers({
			toFake: [
				'Date',
				'setTimeout',
				'clearTimeout',
				'setInterval',
				'clearInterval',
			],
			shouldAdvanceTime: true,
		})
		vi.setSystemTime(jst(10, 12))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('tickets grouped by event with their face', () => {
		it('shows one event with its three tickets, each with the face and 未入場', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Fan opens their tickets"
			ticketClient.getMyTickets.mockResolvedValue([
				protoTicket(1),
				protoTicket(2),
				protoTicket(3),
			])
			const sut = await open()

			expect(sut.step).toBe('loaded')
			expect(sut.groups).toHaveLength(1)
			const [group] = sut.groups
			expect(group.event?.title).toBe('LIVE 20')
			expect(group.event?.venueName).toBe('Shibuya WWW')
			expect(sut.time(group.event?.openTime)).toBe('17:30')
			expect(sut.time(group.event?.startTime)).toBe('18:30')
			expect(group.tickets).toHaveLength(3)
			for (const t of group.tickets) {
				expect(t.state).toBe('not-entered')
				expect(t.holderName).toBe('山田太郎')
				expect(t.resaleWithoutConsentProhibited).toBe(true)
				expect(sut.stateLabel(t)).toBe('tickets.state.not-entered')
			}
			expect(ja.tickets.state['not-entered']).toBe('未入場')
			expect(ja.tickets.resaleProhibited).toContain('転売')
			expect(ja.tickets.field.noSeat).toBe('指定なし')
			// One read per event, not per ticket.
			expect(concertClient.get).toHaveBeenCalledTimes(1)
		})

		it('lists the nearest event first, past events after upcoming ones', async () => {
			ticketClient.getMyTickets.mockResolvedValue([
				protoTicket(1, { event: PAST_EVENT }),
				protoTicket(2, { event: LATER_EVENT }),
				protoTicket(3, { event: EVENT }),
			])
			const sut = await open()
			expect(sut.groups.map((g) => g.eventId)).toEqual([
				EVENT,
				LATER_EVENT,
				PAST_EVENT,
			])
		})

		it('shows a refunded ticket as 無効 without a QR code', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Refunded ticket"
			ticketClient.getMyTickets.mockResolvedValue([
				protoTicket(1, { status: TicketStatus.VOIDED }),
				protoTicket(2, { event: LATER_EVENT, status: TicketStatus.VOIDED }),
				protoTicket(3, { event: LATER_EVENT }),
			])
			const sut = await open()

			const [voidOnly, mixed] = sut.groups
			expect(voidOnly.tickets[0].state).toBe('void')
			expect(sut.stateLabel(voidOnly.tickets[0])).toBe('tickets.state.void')
			expect(ja.tickets.state.void).toBe('無効')
			expect(sut.offersCode(voidOnly)).toBe(false)

			// In a group with other tickets, the void one is never in the code.
			sut.openCode(mixed)
			expect(sut.presented.map((t) => t.id)).toEqual([ticketId(3)])
			sut.closeCode()
		})

		it('shows the tickets loaded earlier when opened without a connection', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "No signal in the venue"
			ticketClient.getMyTickets.mockResolvedValueOnce([
				protoTicket(1),
				protoTicket(2),
			])
			const first = await open()
			first.detaching()

			ticketClient.getMyTickets.mockRejectedValue(offlineError())
			concertClient.get.mockRejectedValue(offlineError())
			const sut = await open()

			expect(sut.step).toBe('loaded')
			expect(sut.offline).toBe(true)
			expect(sut.savedAt).toBeInstanceOf(Date)
			expect(sut.groups[0].event?.title).toBe('LIVE 20')
			expect(sut.groups[0].tickets.map((t) => t.id)).toEqual([
				ticketId(1),
				ticketId(2),
			])
		})

		it('shows the error state when offline with nothing saved', async () => {
			ticketClient.getMyTickets.mockRejectedValue(offlineError())
			const sut = await open()
			expect(sut.step).toBe('error')
		})

		it('shows the empty state for a fan without tickets', async () => {
			const sut = await open()
			expect(sut.step).toBe('empty')
		})
	})

	describe('the entry device is chosen once and moves only when the fan asks', () => {
		it('makes a phone the entry device without asking when the fan has none, and shows the code offline afterwards', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "First visit on a phone"
			await prepareOnline([protoTicket(1)])

			expect(keyClient.get).toHaveBeenCalledTimes(1)
			expect(keyClient.register).toHaveBeenCalledTimes(1)
			const publicKey = keyClient.register.mock.calls[0][0] as Uint8Array
			expect(publicKey).toHaveLength(65)
			expect(publicKey[0]).toBe(0x04)
			expect(storage.deviceKey?.lastCheck).toBe('entry')
			expect(storage.deviceKey?.keyPair?.privateKey.extractable).toBe(false)

			// Later, in the venue without a connection.
			ticketClient.getMyTickets.mockRejectedValue(offlineError())
			const sut = await open()
			expect(sut.device).toBe('ready')
			expect(sut.canShowCode).toBe(true)
			sut.openCode(sut.groups[0])
			const code = await currentCode(sut)
			expect(
				await verifies(
					publicKey,
					code?.signature ?? new Uint8Array(),
					code?.signedBytes ?? new Uint8Array(),
				),
			).toBe(true)
			sut.closeCode()
		})

		it('registers nothing when reloaded on the entry device and offers the code', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Reloading on the entry device"
			await prepareOnline([protoTicket(1)])
			keyClient.register.mockClear()
			keyClient.get.mockClear()

			ticketClient.getMyTickets.mockResolvedValue([protoTicket(1)])
			const sut = await open()

			expect(keyClient.get).toHaveBeenCalledTimes(1)
			expect(keyClient.register).not.toHaveBeenCalled()
			expect(sut.device).toBe('ready')
			expect(sut.canShowCode).toBe(true)
			expect(sut.movedToThisDevice).toBe(false)
		})

		it('shows the tickets on another device without a QR code and leaves the phone the entry device', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Viewing on another device"
			const phoneKey = await otherDeviceKey()
			serverKey = phoneKey
			ticketClient.getMyTickets.mockResolvedValue([protoTicket(1)])

			const pc = await open()

			expect(pc.step).toBe('loaded')
			expect(pc.groups[0].tickets).toHaveLength(1)
			expect(pc.device).toBe('other-device')
			expect(ja.tickets.device.otherDevice).toContain('別の端末')
			expect(pc.canShowCode).toBe(false)
			pc.openCode(pc.groups[0])
			expect(pc.isCodeOpen).toBe(false)
			expect(keyClient.register).not.toHaveBeenCalled()
			expect(serverKey).toEqual(phoneKey)

			expect(pc.canOfferMove).toBe(true)
		})

		it('says the code is set to another device again offline and offers neither the code nor the move', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Other device without a connection"
			serverKey = await otherDeviceKey()
			ticketClient.getMyTickets.mockResolvedValueOnce([protoTicket(1)])
			const online = await open()
			expect(online.device).toBe('other-device')
			online.detaching()

			ticketClient.getMyTickets.mockRejectedValue(offlineError())
			keyClient.get.mockRejectedValue(offlineError())
			const sut = await open()

			expect(sut.offline).toBe(true)
			expect(sut.device).toBe('other-device')
			expect(sut.canShowCode).toBe(false)
			sut.openCode(sut.groups[0])
			expect(sut.isCodeOpen).toBe(false)
			expect(sut.canOfferMove).toBe(false)
			sut.askToUseThisDevice()
			expect(sut.confirmingMove).toBe(false)
			expect(keyClient.register).not.toHaveBeenCalled()
		})

		it('still offers the code on the entry device when the key cannot be read', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Key cannot be read"
			await prepareOnline([protoTicket(1)])
			keyClient.register.mockClear()

			ticketClient.getMyTickets.mockResolvedValue([protoTicket(1)])
			keyClient.get.mockRejectedValueOnce(
				new ConnectError('internal', Code.Internal),
			)
			const sut = await open()

			expect(sut.offline).toBe(false)
			expect(sut.device).toBe('ready')
			expect(sut.canShowCode).toBe(true)
			expect(keyClient.register).not.toHaveBeenCalled()
			sut.openCode(sut.groups[0])
			await currentCode(sut)
			sut.closeCode()
		})

		it('moves the entry device to a new phone only after the fan confirms', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Moving to a new phone"
			const oldPhone = storage
			await prepareOnline([protoTicket(1)])
			const oldKey = serverKey ?? new Uint8Array()

			storage = new FakeWalletStorage()
			keyClient.register.mockClear()
			ticketClient.getMyTickets.mockResolvedValue([protoTicket(1)])
			const newPhone = await open()
			expect(newPhone.device).toBe('other-device')

			newPhone.askToUseThisDevice()
			expect(newPhone.confirmingMove).toBe(true)
			expect(keyClient.register).not.toHaveBeenCalled()

			await newPhone.confirmUseThisDevice()
			expect(keyClient.register).toHaveBeenCalledTimes(1)
			expect(newPhone.device).toBe('ready')
			expect(newPhone.movedToThisDevice).toBe(true)
			expect(newPhone.confirmingMove).toBe(false)
			expect(ja.tickets.device.movedHere).toContain('この端末でのみ')
			const newKey = serverKey ?? new Uint8Array()
			expect(sameBytes(newKey, oldKey)).toBe(false)

			newPhone.openCode(newPhone.groups[0])
			const code = await currentCode(newPhone)
			expect(
				await verifies(
					newKey,
					code?.signature ?? new Uint8Array(),
					code?.signedBytes ?? new Uint8Array(),
				),
			).toBe(true)
			newPhone.closeCode()

			// A code the old phone still makes no longer verifies with the fan's key.
			const oldPair = oldPhone.deviceKey?.keyPair
			expect(oldPair).toBeTruthy()
			const signed = new Uint8Array([1, 2, 3])
			const oldSignature = new Uint8Array(
				await crypto.subtle.sign(
					SIGN_ALGORITHM,
					oldPair?.privateKey as CryptoKey,
					signed,
				),
			)
			expect(await verifies(newKey, oldSignature, signed)).toBe(false)

			// The old phone, opened online again, is no longer the entry device.
			storage = oldPhone
			const old = await open()
			expect(old.device).toBe('other-device')
			expect(old.canShowCode).toBe(false)
		})

		it('keeps the other device when the fan cancels', async () => {
			serverKey = await otherDeviceKey()
			ticketClient.getMyTickets.mockResolvedValue([protoTicket(1)])
			const sut = await open()

			sut.askToUseThisDevice()
			sut.cancelMove()
			expect(sut.confirmingMove).toBe(false)
			expect(keyClient.register).not.toHaveBeenCalled()
			expect(sut.device).toBe('other-device')
		})

		it('says the move failed, offers to try again and offers no code', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Moving fails"
			const phoneKey = await otherDeviceKey()
			serverKey = phoneKey
			ticketClient.getMyTickets.mockResolvedValue([protoTicket(1)])
			const sut = await open()

			keyClient.register.mockRejectedValueOnce(
				new ConnectError('internal', Code.Internal),
			)
			sut.askToUseThisDevice()
			await sut.confirmUseThisDevice()

			expect(sut.moveFailed).toBe(true)
			expect(ja.tickets.device.moveFailed).toContain('切り替えられませんでした')
			// The confirmation stays open, so the fan can try again.
			expect(sut.confirmingMove).toBe(true)
			expect(sut.canOfferMove).toBe(true)
			expect(sut.device).toBe('other-device')
			expect(sut.canShowCode).toBe(false)
			sut.openCode(sut.groups[0])
			expect(sut.isCodeOpen).toBe(false)
			expect(serverKey).toEqual(phoneKey)

			// Trying again works.
			await sut.confirmUseThisDevice()
			expect(sut.moveFailed).toBe(false)
			expect(sut.device).toBe('ready')
			expect(sut.movedToThisDevice).toBe(true)
		})

		it('says a connection is needed once when opened offline on an unprepared phone', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Not prepared and offline"
			ticketClient.getMyTickets.mockResolvedValueOnce([protoTicket(1)])
			keyClient.get.mockRejectedValueOnce(offlineError())
			const first = await open()
			expect(first.device).toBe('failed')
			first.detaching()

			ticketClient.getMyTickets.mockRejectedValue(offlineError())
			const sut = await open()
			expect(sut.device).toBe('needs-connection')
			expect(sut.canShowCode).toBe(false)
			sut.openCode(sut.groups[0])
			expect(sut.isCodeOpen).toBe(false)
			expect(keyClient.register).not.toHaveBeenCalled()
			expect(ja.tickets.device.needsConnection).toContain(
				'一度インターネットに接続',
			)
		})
	})

	describe('one QR code for the tickets entering together', () => {
		it('shows one code for 3名 that changes every 15 seconds', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Whole group"
			ticketClient.getMyTickets.mockResolvedValue([
				protoTicket(1),
				protoTicket(2),
				protoTicket(3),
			])
			const sut = await open()
			sut.openCode(sut.groups[0])

			expect(sut.headCount).toBe(3)
			expect(ja.tickets.code.headCount).toBe('{{count}}名')
			const first = await currentCode(sut)
			expect(first?.userId).toBe(USER)
			expect(first?.eventId).toBe(EVENT)
			expect(first?.ticketIds).toEqual([ticketId(1), ticketId(2), ticketId(3)])
			expect(sut.codeImage.startsWith('data:image/svg+xml,')).toBe(true)
			const firstText = sut.session.text

			await vi.advanceTimersByTimeAsync(15_000)
			const second = await currentCode(sut)
			expect(sut.session.text).not.toBe(firstText)
			expect((second?.signTime ?? 0) - (first?.signTime ?? 0)).toBe(15)
			sut.closeCode()
		})

		it('presents all three tickets and renders no way to leave one out', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "No ticket left out"
			ticketClient.getMyTickets.mockResolvedValue([
				protoTicket(1),
				protoTicket(2),
				protoTicket(3),
			])
			const fixture = await createFixture(
				'<tickets-route component.ref="route"></tickets-route>',
				class Host {
					public route!: TicketsRoute
				},
				[
					I18nConfiguration.customize((o) => {
						o.initOptions = {
							lng: 'ja',
							resources: { ja: { translation: ja } },
						}
					}),
					TicketsRoute,
					BottomSheetStub,
					Registration.instance(ITicketRpcClient, ticketClient),
					Registration.instance(IWalletPublicKeyRpcClient, keyClient),
					Registration.instance(IConcertRpcClient, concertClient),
					Registration.instance(IWalletStorage, storage),
					Registration.singleton(ITicketWallet, TicketWallet),
					Registration.instance(IScreenWakeLock, wakeLock),
					Registration.instance(IUserStore, { currentLanguage: 'ja' }),
				],
			).started
			const sut = fixture.component.route
			// The router calls loading(); the fixture has no router.
			sut.loading()
			await vi.waitFor(() => expect(sut.device).toBe('ready'))

			sut.openCode(sut.groups[0])
			const code = await currentCode(sut)
			await tasksSettled()

			expect(sut.headCount).toBe(3)
			expect(code?.ticketIds).toEqual([ticketId(1), ticketId(2), ticketId(3)])
			const sheet = fixture.appHost.querySelector('.tickets-code')
			expect(sheet?.textContent).toContain('3名')
			const presented = [
				...(sheet?.querySelectorAll('.tickets-code-tickets li') ?? []),
			].map((li) => li.textContent?.trim())
			expect(presented).toEqual(['チケット 1', 'チケット 2', 'チケット 3'])
			// Nothing in the sheet can take a ticket out of the code.
			expect(
				sheet?.querySelectorAll('input, select, [role="checkbox"]'),
			).toHaveLength(0)
			const buttons = [...(sheet?.querySelectorAll('button') ?? [])]
			expect(buttons.map((b) => b.textContent?.trim())).toEqual([
				ja.tickets.code.close,
			])

			sut.closeCode()
			await fixture.stop(true)
		})

		it('never presents more than 10 tickets', async () => {
			ticketClient.getMyTickets.mockResolvedValue(
				Array.from({ length: 12 }, (_, i) => protoTicket(i + 1)),
			)
			const sut = await open()
			sut.openCode(sut.groups[0])
			expect(sut.headCount).toBe(10)
			const code = await currentCode(sut)
			expect(code?.ticketIds).toEqual(
				Array.from({ length: 10 }, (_, i) => ticketId(i + 1)),
			)
			sut.closeCode()
		})

		it('makes and rotates the code without a connection', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Shown without a connection"
			await prepareOnline([protoTicket(1), protoTicket(2)])
			ticketClient.getMyTickets.mockRejectedValue(offlineError())
			concertClient.get.mockRejectedValue(offlineError())
			const sut = await open()
			expect(sut.offline).toBe(true)

			sut.openCode(sut.groups[0])
			const first = await currentCode(sut)
			expect(first?.ticketIds).toHaveLength(2)
			await vi.advanceTimersByTimeAsync(15_000)
			const second = await currentCode(sut)
			expect(second?.signTime).toBe((first?.signTime ?? 0) + 15)
			// Polling for admissions failed quietly; the code stays.
			expect(sut.session.text).not.toBeNull()
			sut.closeCode()
		})

		it('keeps the display awake while the code is shown and lets it sleep on close', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "Screen stays on"
			ticketClient.getMyTickets.mockResolvedValue([protoTicket(1)])
			const sut = await open()
			sut.openCode(sut.groups[0])
			expect(wakeLock.acquire).toHaveBeenCalledTimes(1)

			await vi.advanceTimersByTimeAsync(2 * 60_000)
			expect(wakeLock.release).not.toHaveBeenCalled()
			// Still showing a fresh code after 2 minutes.
			await currentCode(sut)

			sut.closeCode()
			expect(wakeLock.release).toHaveBeenCalledTimes(1)
			expect(sut.session.text).toBeNull()
		})

		it('shows tickets admitted while the code is shown as 入場済み with the admitted time', async () => {
			// @spec components/infrastructure/fan/web/route/tickets "After entry"
			ticketClient.getMyTickets.mockResolvedValue([
				protoTicket(1),
				protoTicket(2),
			])
			const sut = await open()
			sut.openCode(sut.groups[0])
			await currentCode(sut)

			ticketClient.getMyTickets.mockResolvedValue([
				protoTicket(1, { admitted: jst(10, 12, 0, 3) }),
				protoTicket(2, { admitted: jst(10, 12, 0, 3) }),
			])
			await vi.advanceTimersByTimeAsync(5_000)
			await vi.waitFor(() =>
				expect(sut.groups[0].tickets.every((t) => t.state === 'entered')).toBe(
					true,
				),
			)
			const [t1] = sut.groups[0].tickets
			expect(sut.stateLabel(t1)).toBe('tickets.state.entered')
			expect(ja.tickets.state.entered).toBe('入場済み')
			expect(sut.admitted(t1)).toContain('12:00')
			// Nothing is left to enter, so no code is shown.
			expect(sut.headCount).toBe(0)
			expect(ja.tickets.code.allEntered).toContain('入場済み')
			expect(sut.session.text).toBeNull()
			sut.closeCode()
		})

		it('withdraws the code when closed or when the screen leaves', async () => {
			ticketClient.getMyTickets.mockResolvedValue([protoTicket(1)])
			const sut = await open()
			sut.openCode(sut.groups[0])
			await currentCode(sut)
			sut.detaching()
			expect(sut.isCodeOpen).toBe(false)
			expect(sut.session.text).toBeNull()
			expect(wakeLock.release).toHaveBeenCalled()
		})
	})
})
