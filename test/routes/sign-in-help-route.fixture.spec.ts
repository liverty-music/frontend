import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Code, ConnectError } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IUserRpcClient } from '../../src/adapter/rpc/client/user-client'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import ja from '../../src/locales/ja/translation.json'
import { SignInHelpRoute } from '../../src/routes/sign-in-help/sign-in-help-route'

const SENT = ja.signInHelp.sent

async function render(
	requestPasskeyRecovery: (email: string) => Promise<void> = async () => {},
) {
	const rpc = { requestPasskeyRecovery: vi.fn(requestPasskeyRecovery) }
	const fixture = await createFixture
		.html('<sign-in-help-route></sign-in-help-route>')
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
			SignInHelpRoute,
		)
		.build().started
	const q = <T extends Element>(testId: string) =>
		fixture.appHost.querySelector<T>(`[data-testid="${testId}"]`)

	async function settle(): Promise<void> {
		await new Promise((r) => setTimeout(r, 0))
		await tasksSettled()
	}

	async function type(value: string): Promise<void> {
		const input = q<HTMLInputElement>('sign-in-help-email')
		if (!input) throw new Error('no email field')
		input.value = value
		input.dispatchEvent(new Event('input'))
		input.dispatchEvent(new Event('change'))
		await settle()
	}

	async function send(): Promise<void> {
		q<HTMLButtonElement>('sign-in-help-send')?.click()
		await settle()
	}

	return { fixture, rpc, q, type, send, settle }
}

describe('Passkey recovery screen (fixture)', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('sends the address and shows the uniform message instead of the form', async () => {
		// @spec components/infrastructure/fan/web/route/sign-in-help "Fan sends their address"
		const { rpc, q, type, send } = await render()
		await type('fan@example.com')
		await send()

		expect(rpc.requestPasskeyRecovery).toHaveBeenCalledWith('fan@example.com')
		expect(q('sign-in-help-form')).toBeNull()
		expect(q('sign-in-help-sent')?.textContent).toContain(SENT)
	})

	it('shows exactly the same message for an address no account uses', async () => {
		// @spec components/infrastructure/fan/web/route/sign-in-help "Address with no account"
		// The server answers both the same; the screen must not tell them apart.
		const account = await render()
		await account.type('fan@example.com')
		await account.send()
		const noAccount = await render()
		await noAccount.type('nobody@example.com')
		await noAccount.send()

		const text = (r: typeof account) =>
			r.q('sign-in-help-sent')?.textContent?.replace(/\s+/g, ' ').trim()
		expect(text(noAccount)).toBe(text(account))
		expect(text(noAccount)).toContain(SENT)
	})

	it('marks a malformed address invalid and sends nothing', async () => {
		// @spec components/infrastructure/fan/web/route/sign-in-help "Malformed address"
		const { rpc, q, type, send } = await render()
		await type('not-an-email')
		await send()

		expect(rpc.requestPasskeyRecovery).not.toHaveBeenCalled()
		expect(
			q<HTMLInputElement>('sign-in-help-email')?.getAttribute('aria-invalid'),
		).toBe('true')
		expect(q('sign-in-help-form')?.textContent).toContain(
			ja.signInHelp.emailInvalid,
		)
	})

	it('offers to send the link again to the same address after 60 seconds', async () => {
		// @spec components/infrastructure/fan/web/route/sign-in-help "Resend after 60 seconds"
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
		const { rpc, q, type, send, settle } = await render()
		await type('fan@example.com')
		await send()

		const resend = () => q<HTMLButtonElement>('sign-in-help-resend')
		expect(resend()?.disabled).toBe(true)
		expect(resend()?.textContent).toContain('60秒後')

		vi.advanceTimersByTime(59_000)
		await settle()
		expect(resend()?.disabled).toBe(true)
		expect(resend()?.textContent).toContain('1秒後')

		vi.advanceTimersByTime(1_000)
		await settle()
		expect(resend()?.disabled).toBe(false)
		expect(resend()?.textContent).toContain(ja.signInHelp.resend)

		resend()?.click()
		await settle()
		expect(rpc.requestPasskeyRecovery).toHaveBeenCalledTimes(2)
		expect(rpc.requestPasskeyRecovery).toHaveBeenLastCalledWith(
			'fan@example.com',
		)
	})

	it('says to try again later on ResourceExhausted and keeps the address', async () => {
		// @spec components/infrastructure/fan/web/route/sign-in-help "Too many requests"
		const { q, type, send } = await render(async () => {
			throw new ConnectError('limit', Code.ResourceExhausted)
		})
		await type('fan@example.com')
		await send()

		expect(q('sign-in-help-too-many')?.textContent).toBe(ja.signInHelp.tooMany)
		expect(q<HTMLInputElement>('sign-in-help-email')?.value).toBe(
			'fan@example.com',
		)
		expect(q('sign-in-help-sent')).toBeNull()
	})

	it('says the request could not be sent on Unavailable and offers to try again', async () => {
		// @spec components/infrastructure/fan/web/route/sign-in-help "Network failure"
		let fail = true
		const { rpc, q, type, send } = await render(async () => {
			if (fail) throw new ConnectError('down', Code.Unavailable)
		})
		await type('fan@example.com')
		await send()

		expect(q('sign-in-help-failed')?.textContent).toBe(ja.signInHelp.failed)
		expect(q('sign-in-help-send')?.textContent?.trim()).toBe(
			ja.signInHelp.retry,
		)

		fail = false
		await send()
		expect(rpc.requestPasskeyRecovery).toHaveBeenCalledTimes(2)
		expect(q('sign-in-help-sent')?.textContent).toContain(SENT)
	})
})
