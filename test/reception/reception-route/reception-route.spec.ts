import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { RejectedScanReason } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/rejected_scan_pb.js'
import {
	type AdmitResponse,
	AdmitResponseSchema,
	type OpenResponse,
	OpenResponseSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/reception/v1/reception_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import mainSource from '../../../reception/main.ts?raw'
import type { QrScannerFactory } from '../../../reception/reception-route/reception-route'
import shellSource from '../../../reception/reception-shell/reception-shell.ts?raw'
import { signAdmissionCode } from '../../../shared/lib/admission-code/admission-code'

// Replace the RPC client module with a fresh token so the route binds to the
// test double instead of building a real Connect transport.
const IReceptionClient = DI.createInterface('IReceptionClient')
vi.mock('../../../reception/services/reception-client', () => ({
	IReceptionClient,
}))

const { ReceptionRoute, IQrScannerFactory } = await import(
	'../../../reception/reception-route/reception-route'
)

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
const USER = '019a0000-0000-7000-8000-000000000001'
const EVENT = '019a0000-0000-7000-8000-0000000000e1'
const TICKET_1 = '019a0000-0000-7000-8000-000000000101'
const TICKET_2 = '019a0000-0000-7000-8000-000000000102'
const TICKET_3 = '019a0000-0000-7000-8000-000000000103'
const CAPABILITY = 'components/infrastructure/organizer/web/route/reception'

/** 2026-11-20 15:00 JST and 2026-11-21 04:00 JST. */
const WINDOW_OPEN = new Date('2026-11-20T06:00:00Z')
const WINDOW_CLOSE = new Date('2026-11-20T19:00:00Z')

function openResponse(insideWindow: boolean, number = 1): OpenResponse {
	return create(OpenResponseSchema, {
		receptionLink: { number: { value: number } },
		receptionWindow: {
			openTime: timestampFromDate(WINDOW_OPEN),
			closeTime: timestampFromDate(WINDOW_CLOSE),
		},
		insideWindow,
	})
}

function admitResponse(init: Partial<AdmitResponse>): AdmitResponse {
	return create(AdmitResponseSchema, init)
}

interface MockClient {
	open: ReturnType<typeof vi.fn>
	admit: ReturnType<typeof vi.fn>
}

/** A scanner double: records starts and lets the test feed scanned texts. */
class FakeScanner {
	public started = 0
	public stopped = 0
	constructor(public readonly onText: (text: string) => Promise<void>) {}
	public async start(): Promise<void> {
		this.started++
	}
	public stop(): void {
		this.stopped++
	}
}

async function build(client: MockClient) {
	const scanners: FakeScanner[] = []
	const factory: QrScannerFactory = (_video, onText) => {
		const s = new FakeScanner(onText)
		scanners.push(s)
		return s
	}
	const fixture = createFixture
		.html('<reception-route component.ref="route"></reception-route>')
		.deps(
			ReceptionRoute,
			Registration.instance(IReceptionClient, client),
			Registration.instance(IQrScannerFactory, factory),
		)
		.build()
	await fixture.started
	const route = (
		fixture.component as { route: InstanceType<typeof ReceptionRoute> }
	).route
	// The token arrives in the URL fragment; canLoad reads it before attach.
	window.location.hash = `#${TOKEN}`
	route.canLoad({})
	await route.open()
	return {
		fixture,
		route,
		scanners,
		text: () => fixture.appHost.textContent ?? '',
	}
}

describe('ReceptionRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('the reception guide is one tap away', () => {
		const guideLink = (host: Element) =>
			host.querySelector<HTMLAnchorElement>('a[href="/guide.html"]')

		it('links the guide in a new tab while the screen keeps its state', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Staff open the guide"
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(true)),
				admit: vi.fn(),
			}
			const { fixture, route, scanners } = await build(client)
			await route.startScanning()
			expect(scanners).toHaveLength(1)

			const link = guideLink(fixture.appHost)
			expect(link).not.toBeNull()
			expect(link?.textContent).toContain('受付の使い方')
			expect(link?.getAttribute('target')).toBe('_blank')
			expect(link?.getAttribute('rel')).toContain('noopener')
			// A new tab leaves this screen as it was: still scanning, camera on.
			expect(route.phase).toBe('ready')
			expect(scanners[0].stopped).toBe(0)
		})

		it('offers the guide when the link cannot be used', async () => {
			const client: MockClient = {
				open: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('revoked', Code.PermissionDenied),
					),
				admit: vi.fn(),
			}
			const { fixture, route } = await build(client)
			expect(route.phase).toBe('unusable')
			expect(guideLink(fixture.appHost)).not.toBeNull()
		})
	})

	describe('opened from the link without signing in', () => {
		it('opens without a sign-in and shows the link label', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Staff open the link"
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(true)),
				admit: vi.fn(),
			}
			// No IAuthService is registered: the screen cannot ask for a sign-in.
			const { route, text } = await build(client)

			expect(client.open).toHaveBeenCalledWith(TOKEN, expect.any(AbortSignal))
			expect(route.phase).toBe('ready')
			expect(text()).toContain('受付1')
			// The reception app is the screen at the root of its own origin, with
			// no sign-in at all, and its path carries no token (the token is in
			// the fragment).
			expect(shellSource).toMatch(
				/path: '',\s*component: import\('\.\.\/reception-route\/reception-route'\)/,
			)
			expect(shellSource).not.toMatch(/path: '[^']*:/)
			expect(mainSource).not.toMatch(/auth-service|IAuthService/)
		})

		it('says the link is in use on another device', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Forwarded link"
			const client: MockClient = {
				open: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('bound', Code.FailedPrecondition),
					),
				admit: vi.fn(),
			}
			const { route, text } = await build(client)

			expect(route.phase).toBe('other-device')
			expect(text()).toContain('別の端末で使用中')
			expect(text()).toContain('再発行')
			expect(text()).not.toContain('スキャンを開始')
		})

		it('says a revoked link can no longer be used', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Revoked link"
			const client: MockClient = {
				open: vi
					.fn()
					.mockRejectedValue(new ConnectError('denied', Code.PermissionDenied)),
				admit: vi.fn(),
			}
			const { route, text } = await build(client)

			expect(route.phase).toBe('unusable')
			expect(text()).toContain('この受付リンクはもう使えません')
			expect(text()).toContain('時計')
			expect(text()).toContain('新しい受付リンク')
		})

		it('asks to check the phone clock when a call is refused as not allowed', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Phone clock far off"
			// The server's time; the phone runs 2 minutes slow.
			const serverNow = new Date('2026-11-20T07:00:00Z')
			vi.useFakeTimers({ toFake: ['Date'] })
			vi.setSystemTime(new Date(serverNow.getTime() - 120_000))
			// A server that, like ReceptionService, refuses a call whose sign time
			// is more than 30 s before or 15 s after its own clock.
			const client: MockClient = {
				open: vi.fn(async () => {
					const signTime = Math.floor(Date.now() / 1000)
					const skew = signTime - serverNow.getTime() / 1000
					if (skew < -30 || skew > 15) {
						throw new ConnectError('not proven', Code.PermissionDenied)
					}
					return openResponse(true)
				}),
				admit: vi.fn(),
			}
			const { route, text } = await build(client)

			expect(route.phase).toBe('unusable')
			expect(text()).toContain('この受付リンクはもう使えません')
			expect(text()).toContain('時計')
			expect(text()).not.toContain('スキャンを開始')
		})

		it('treats a malformed token as an unusable link without calling the server', async () => {
			const client: MockClient = { open: vi.fn(), admit: vi.fn() }
			const { route } = await build(client)
			client.open.mockClear()
			window.location.hash = '#short'
			route.canLoad({})
			await route.open()
			expect(route.phase).toBe('unusable')
			expect(client.open).not.toHaveBeenCalled()
		})

		it('offers a retry when the server cannot be reached', async () => {
			const client: MockClient = {
				open: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
				admit: vi.fn(),
			}
			const { route, text } = await build(client)
			expect(route.phase).toBe('unreachable')
			expect(text()).toContain('もう一度試す')
		})

		it('says to wait when the client is throttled', async () => {
			const client: MockClient = {
				open: vi
					.fn()
					.mockRejectedValue(new ConnectError('slow', Code.ResourceExhausted)),
				admit: vi.fn(),
			}
			const { route } = await build(client)
			expect(route.phase).toBe('throttled')
		})
	})

	describe('scanning only during the reception window', () => {
		it('shows when reception starts and does not start the camera', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Opened the day before"
			vi.useFakeTimers({ toFake: ['Date'] })
			vi.setSystemTime(new Date('2026-11-19T06:00:00Z'))
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(false)),
				admit: vi.fn(),
			}
			const { route, scanners, text } = await build(client)

			expect(route.windowState).toBe('before')
			expect(text()).toContain('受付は 2026-11-20 15:00 から始まります')
			expect(text()).not.toContain('スキャンを開始')
			await route.startScanning()
			expect(scanners).toHaveLength(0)
		})

		it('says when reception ended after the window and does not start the camera', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Reception over"
			vi.useFakeTimers({ toFake: ['Date'] })
			// 2026-11-21 05:00 JST; the window closed at 04:00 JST.
			vi.setSystemTime(new Date('2026-11-20T20:00:00Z'))
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(false)),
				admit: vi.fn(),
			}
			const { route, scanners, text } = await build(client)
			expect(route.windowState).toBe('after')
			expect(text()).toContain('受付は 2026-11-21 04:00 に終了しました')
			expect(text()).not.toContain('スキャンを開始')
			await route.startScanning()
			expect(scanners).toHaveLength(0)
		})

		it('says reception times are not set when the event has no window', async () => {
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(
					create(OpenResponseSchema, {
						receptionLink: { number: { value: 1 } },
						insideWindow: false,
					}),
				),
				admit: vi.fn(),
			}
			const { route, scanners, text } = await build(client)
			expect(route.windowState).toBe('none')
			expect(text()).toContain('受付時間が決まっていません')
			await route.startScanning()
			expect(scanners).toHaveLength(0)
		})

		it('starts the camera only on tap and scans what it reads', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Start scanning"
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(true)),
				admit: vi
					.fn()
					.mockResolvedValue(admitResponse({ admittedTicketCount: 1 })),
			}
			const { route, scanners, text } = await build(client)

			// Nothing asked for the camera before the tap.
			expect(scanners).toHaveLength(0)
			expect(text()).toContain('スキャンを開始')

			await route.startScanning()
			expect(scanners).toHaveLength(1)
			expect(scanners[0].started).toBe(1)
			expect(route.scanning).toBe(true)

			// QR codes in view are sent, one after another, until staff stop.
			await scanners[0].onText('CODE-A')
			await scanners[0].onText('CODE-B')
			expect(client.admit).toHaveBeenNthCalledWith(1, TOKEN, 'CODE-A')
			expect(client.admit).toHaveBeenNthCalledWith(2, TOKEN, 'CODE-B')

			route.stopScanning()
			expect(scanners[0].stopped).toBe(1)
			expect(route.scanning).toBe(false)
		})

		it('says the camera could not be used when it is refused', async () => {
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(true)),
				admit: vi.fn(),
			}
			const { route, scanners } = await build(client)
			const failing = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
			route.video = document.createElement('video')
			;(
				route as unknown as { scannerFactory: QrScannerFactory }
			).scannerFactory = () => ({ start: failing, stop: vi.fn() })
			await route.startScanning()
			expect(route.scanning).toBe(false)
			expect(route.cameraError).toContain('カメラ')
			expect(scanners).toHaveLength(0)
		})

		it('stops and re-reads the window when a scan arrives outside it', async () => {
			const client: MockClient = {
				open: vi
					.fn()
					.mockResolvedValueOnce(openResponse(true))
					.mockResolvedValue(openResponse(false)),
				admit: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('closed', Code.FailedPrecondition),
					),
			}
			const { route, scanners } = await build(client)
			await route.startScanning()
			await scanners[0].onText('CODE')
			await vi.waitFor(() => expect(client.open).toHaveBeenCalledTimes(2))
			await vi.waitFor(() => expect(route.windowState).not.toBe('inside'))
			expect(scanners[0].stopped).toBe(1)
			expect(route.verdict).toBeNull()
		})

		it('stops scanning when the link is revoked during the show', async () => {
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(true)),
				admit: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('revoked', Code.PermissionDenied),
					),
			}
			const { route, scanners, text } = await build(client)
			await route.startScanning()
			await scanners[0].onText('CODE')
			expect(route.phase).toBe('unusable')
			expect(scanners[0].stopped).toBe(1)
			expect(text()).toContain('この受付リンクはもう使えません')
		})
	})

	describe('the verdict without personal data', () => {
		async function scan(response: AdmitResponse) {
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(true)),
				admit: vi.fn().mockResolvedValue(response),
			}
			const built = await build(client)
			await built.route.startScanning()
			await built.scanners[0].onText('CODE')
			return built
		}

		it('shows OK and the head count for a group', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Group admitted"
			const { route, text } = await scan(
				admitResponse({ admittedTicketCount: 3 }),
			)
			expect(route.verdict?.tone).toBe('ok')
			const verdict = text()
			expect(verdict).toContain('OK')
			expect(verdict).toContain('3名')
			expect(verdict).not.toContain('NG')
			// The response carries no name, and the screen shows only the verdict.
			expect(route.verdict?.reasons).toHaveLength(0)
		})

		it('shows NG, already used, the earlier time and link label', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Ticket used earlier"
			const { route, text } = await scan(
				admitResponse({
					admittedTicketCount: 0,
					rejectedTickets: [
						{
							reason: RejectedScanReason.ALREADY_ADMITTED,
							// 18:32 JST.
							earlierAdmitTime: timestampFromDate(
								new Date('2026-11-20T09:32:00Z'),
							),
							earlierReceptionLinkNumber: { value: 1 },
						},
					],
				}),
			)
			expect(route.verdict?.tone).toBe('ng')
			const verdict = text()
			expect(verdict).toContain('NG')
			expect(verdict).toContain('使用済み')
			expect(verdict).toContain('18:32')
			expect(verdict).toContain('受付1')
		})

		it('shows NG and asks the fan to reopen an expired code', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Screenshot"
			const { route, text } = await scan(
				admitResponse({ rejectedScanReason: RejectedScanReason.EXPIRED }),
			)
			expect(route.verdict?.tone).toBe('ng')
			expect(text()).toContain('NG')
			expect(text()).toContain('有効期限切れ')
			expect(text()).toContain('開き直して')
		})

		it('shows how many to let in and why the rest are refused', async () => {
			const { route, text } = await scan(
				admitResponse({
					admittedTicketCount: 2,
					rejectedTickets: [{ reason: RejectedScanReason.VOIDED }],
				}),
			)
			expect(route.verdict?.tone).toBe('partial')
			expect(text()).toContain('OK')
			expect(text()).toContain('2名だけ入場させてください')
			expect(text()).toContain('無効なチケット')
			expect(text()).toContain('1名')
		})

		it('keeps OK and sends no further code of that fan for 20 seconds', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Code still in view after OK"
			vi.useFakeTimers({ toFake: ['Date'] })
			const t0 = new Date('2026-11-20T09:00:00Z')
			vi.setSystemTime(t0)
			// The fan's phone renews its code every 15 s: same group, new text.
			const { privateKey } = await crypto.subtle.generateKey(
				{ name: 'ECDSA', namedCurve: 'P-256' },
				false,
				['sign', 'verify'],
			)
			const code = (signTime: number) =>
				signAdmissionCode(privateKey, {
					userId: USER,
					eventId: EVENT,
					ticketIds: [TICKET_1, TICKET_2, TICKET_3],
					signTime,
				})
			const first = await code(t0.getTime() / 1000)
			const renewed = await code(t0.getTime() / 1000 + 15)
			const afterward = await code(t0.getTime() / 1000 + 30)
			expect(renewed).not.toBe(first)

			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(true)),
				admit: vi
					.fn()
					.mockResolvedValue(admitResponse({ admittedTicketCount: 3 })),
			}
			const { route, scanners, text } = await build(client)
			await route.startScanning()
			await scanners[0].onText(first)
			expect(route.verdict?.tone).toBe('ok')

			vi.setSystemTime(new Date(t0.getTime() + 15_000))
			await scanners[0].onText(first)
			await scanners[0].onText(renewed)
			expect(client.admit).toHaveBeenCalledTimes(1)
			expect(route.verdict?.tone).toBe('ok')
			expect(text()).toContain('3名')
			expect(text()).not.toContain('NG')

			// After 20 seconds the same fan's code is sent again.
			vi.setSystemTime(new Date(t0.getTime() + 20_001))
			await scanners[0].onText(afterward)
			expect(client.admit).toHaveBeenCalledTimes(2)
		})
	})

	describe('fail closed without a connection', () => {
		it('shows the scan was not decided, offers a retry and never OK', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Network down"
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(true)),
				admit: vi
					.fn()
					.mockRejectedValueOnce(new ConnectError('down', Code.Unavailable))
					.mockRejectedValueOnce(new TypeError('Failed to fetch'))
					.mockResolvedValue(admitResponse({ admittedTicketCount: 1 })),
			}
			vi.useFakeTimers({ toFake: ['Date'] })
			const t0 = new Date('2026-11-20T09:00:00Z')
			vi.setSystemTime(t0)
			const { route, scanners, text } = await build(client)
			await route.startScanning()
			await scanners[0].onText('CODE')

			// While the code stays in view, it is retried by itself at most every 3 s.
			await scanners[0].onText('CODE')
			expect(client.admit).toHaveBeenCalledTimes(1)
			vi.setSystemTime(new Date(t0.getTime() + 3_000))
			await scanners[0].onText('CODE')
			expect(client.admit).toHaveBeenCalledTimes(2)

			expect(route.verdict?.tone).toBe('undecided')
			expect(text()).toContain('判定できませんでした')
			expect(text()).toContain('もう一度送信する')
			expect(text()).not.toContain('OK')

			await route.retry()
			expect(client.admit).toHaveBeenLastCalledWith(TOKEN, 'CODE')
			expect(route.verdict?.tone).toBe('ok')
		})
	})

	describe('scanning again', () => {
		it('clears the previous verdict when staff start scanning again', async () => {
			// @spec components/infrastructure/organizer/web/route/reception "Scanning again after stopping"
			const client: MockClient = {
				open: vi.fn().mockResolvedValue(openResponse(true)),
				admit: vi
					.fn()
					.mockResolvedValue(admitResponse({ admittedTicketCount: 3 })),
			}
			const { route, scanners, text } = await build(client)

			await route.startScanning()
			await scanners[0].onText('CODE-A')
			expect(route.verdict?.tone).toBe('ok')
			await tasksSettled()
			expect(text()).toContain('3名')

			route.stopScanning()
			// The last verdict stays readable while scanning is stopped.
			expect(route.verdict?.tone).toBe('ok')

			await route.startScanning()
			await tasksSettled()
			expect(route.verdict).toBeNull()
			expect(text()).not.toContain('3名')
		})
	})
})
