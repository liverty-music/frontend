import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Code, ConnectError } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IUserRpcClient } from '../../src/adapter/rpc/client/user-client'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import ja from '../../src/locales/ja/translation.json'
import { PasskeyRecoveryRoute } from '../../src/routes/passkey-recovery/passkey-recovery-route'

const SENT = ja.passkeyRecovery.sent

async function render(
	requestPasskeyRecovery: (email: string) => Promise<void> = async () => {},
) {
	const rpc = { requestPasskeyRecovery: vi.fn(requestPasskeyRecovery) }
	const fixture = await createFixture
		.html('<passkey-recovery-route></passkey-recovery-route>')
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: 'ja',
					resources: { ja: { translation: ja } },
					fallbackLng: 'ja',
				}
			}),
			Registration.instance(IUserRpcClient, rpc),
			BusyOnClickCustomAttribute,
			PasskeyRecoveryRoute,
		)
		.build().started
	const q = <T extends Element>(testId: string) =>
		fixture.appHost.querySelector<T>(`[data-testid="${testId}"]`)

	async function settle(): Promise<void> {
		await new Promise((r) => setTimeout(r, 0))
		await tasksSettled()
	}

	async function type(value: string): Promise<void> {
		const input = q<HTMLInputElement>('passkey-recovery-email')
		if (!input) throw new Error('no email field')
		input.value = value
		input.dispatchEvent(new Event('input'))
		input.dispatchEvent(new Event('change'))
		await settle()
	}

	async function send(): Promise<void> {
		q<HTMLButtonElement>('passkey-recovery-send')?.click()
		await settle()
	}

	return { fixture, rpc, q, type, send, settle }
}

describe('Passkey recovery screen (fixture)', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('sends the address and shows the uniform message instead of the form', async () => {
		// @spec components/infrastructure/fan/web/route/passkey-recovery "Fan sends their address"
		const { rpc, q, type, send } = await render()
		await type('fan@example.com')
		await send()

		expect(rpc.requestPasskeyRecovery).toHaveBeenCalledWith('fan@example.com')
		expect(q('passkey-recovery-form')).toBeNull()
		expect(q('passkey-recovery-sent')?.textContent).toContain(SENT)
	})

	it('shows exactly the same message for an address no account uses', async () => {
		// @spec components/infrastructure/fan/web/route/passkey-recovery "Address with no account"
		// The server answers both the same; the screen must not tell them apart.
		const account = await render()
		await account.type('fan@example.com')
		await account.send()
		const noAccount = await render()
		await noAccount.type('nobody@example.com')
		await noAccount.send()

		const text = (r: typeof account) =>
			r.q('passkey-recovery-sent')?.textContent?.replace(/\s+/g, ' ').trim()
		expect(text(noAccount)).toBe(text(account))
		expect(text(noAccount)).toContain(SENT)
	})

	it('marks a malformed address invalid and sends nothing', async () => {
		// @spec components/infrastructure/fan/web/route/passkey-recovery "Malformed address"
		const { rpc, q, type, send } = await render()
		await type('not-an-email')
		await send()

		expect(rpc.requestPasskeyRecovery).not.toHaveBeenCalled()
		expect(
			q<HTMLInputElement>('passkey-recovery-email')?.getAttribute(
				'aria-invalid',
			),
		).toBe('true')
		expect(q('passkey-recovery-form')?.textContent).toContain(
			ja.passkeyRecovery.emailInvalid,
		)
	})

	it('offers to send the link again to the same address after 60 seconds', async () => {
		// @spec components/infrastructure/fan/web/route/passkey-recovery "Resend after 60 seconds"
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
		const { rpc, q, type, send, settle } = await render()
		await type('fan@example.com')
		await send()

		const resend = () => q<HTMLButtonElement>('passkey-recovery-resend')
		expect(resend()?.disabled).toBe(true)
		expect(resend()?.textContent).toContain('60秒後')

		vi.advanceTimersByTime(59_000)
		await settle()
		expect(resend()?.disabled).toBe(true)
		expect(resend()?.textContent).toContain('1秒後')

		vi.advanceTimersByTime(1_000)
		await settle()
		expect(resend()?.disabled).toBe(false)
		expect(resend()?.textContent).toContain(ja.passkeyRecovery.resend)

		resend()?.click()
		await settle()
		expect(rpc.requestPasskeyRecovery).toHaveBeenCalledTimes(2)
		expect(rpc.requestPasskeyRecovery).toHaveBeenLastCalledWith(
			'fan@example.com',
		)
	})

	it('says to try again later on ResourceExhausted and keeps the address', async () => {
		// @spec components/infrastructure/fan/web/route/passkey-recovery "Too many requests"
		const { q, type, send } = await render(async () => {
			throw new ConnectError('limit', Code.ResourceExhausted)
		})
		await type('fan@example.com')
		await send()

		expect(q('passkey-recovery-too-many')?.textContent).toBe(
			ja.passkeyRecovery.tooMany,
		)
		expect(q<HTMLInputElement>('passkey-recovery-email')?.value).toBe(
			'fan@example.com',
		)
		expect(q('passkey-recovery-sent')).toBeNull()
	})

	it('says the request could not be sent on Unavailable and offers to try again', async () => {
		// @spec components/infrastructure/fan/web/route/passkey-recovery "Network failure"
		let fail = true
		const { rpc, q, type, send } = await render(async () => {
			if (fail) throw new ConnectError('down', Code.Unavailable)
		})
		await type('fan@example.com')
		await send()

		expect(q('passkey-recovery-failed')?.textContent).toBe(
			ja.passkeyRecovery.failed,
		)
		expect(q('passkey-recovery-send')?.textContent?.trim()).toBe(
			ja.passkeyRecovery.retry,
		)

		fail = false
		await send()
		expect(rpc.requestPasskeyRecovery).toHaveBeenCalledTimes(2)
		expect(q('passkey-recovery-sent')?.textContent).toContain(SENT)
	})
})
