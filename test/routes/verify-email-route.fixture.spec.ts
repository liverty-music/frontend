import { I18nConfiguration } from '@aurelia/i18n'
import type { RouteNode } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { IUserRpcClient } from '../../src/adapter/rpc/client/user-client'
import ja from '../../src/locales/ja/translation.json'
import { VerifyEmailRoute } from '../../src/routes/verify-email/verify-email-route'

const USER_ID = '019a0000-0000-7000-8000-000000000001'

async function render(
	query: string,
	verifyEmail: (userId: string, code: string) => Promise<void> = async () => {},
) {
	const rpc = { verifyEmail: vi.fn(verifyEmail) }
	const fixture = await createFixture
		.html('<verify-email-route></verify-email-route>')
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: 'ja',
					resources: { ja: { translation: ja } },
					fallbackLng: 'ja',
				}
			}),
			Registration.instance(IUserRpcClient, rpc),
			VerifyEmailRoute,
		)
		.build().started
	const q = <T extends Element>(testId: string) =>
		fixture.appHost.querySelector<T>(`[data-testid="${testId}"]`)

	async function settle(): Promise<void> {
		await new Promise((r) => setTimeout(r, 0))
		await tasksSettled()
	}

	// The router hook is not run by the fixture: hand it the link's query.
	const host = fixture.appHost.querySelector('verify-email-route')
	if (!host) throw new Error('no verify-email-route')
	const vm = CustomElement.for<VerifyEmailRoute>(host).viewModel
	vm.loading({}, { queryParams: new URLSearchParams(query) } as RouteNode)
	await settle()

	async function confirm(): Promise<void> {
		q<HTMLButtonElement>('verify-email-confirm')?.click()
		await settle()
	}

	return { rpc, q, confirm, settle }
}

const link = `user=${USER_ID}&code=AB12CD`

describe('Email verification screen (fixture)', () => {
	it('shows the confirm action on opening and verifies nothing', async () => {
		// @spec components/infrastructure/fan/web/route/verify-email "Opening the link"
		const { rpc, q } = await render(link)

		expect(q('verify-email-confirm')?.textContent).toContain(
			ja.verifyEmail.confirm,
		)
		expect(rpc.verifyEmail).not.toHaveBeenCalled()
	})

	it("verifies with the link's User and code on the tap and offers to open the app", async () => {
		// @spec components/infrastructure/fan/web/route/verify-email "Fan confirms"
		// @spec components/infrastructure/fan/web/route/verify-email "Verified"
		const { rpc, q, confirm } = await render(link)
		await confirm()

		expect(rpc.verifyEmail).toHaveBeenCalledExactlyOnceWith(USER_ID, 'AB12CD')
		expect(q('verify-email-verified')?.textContent).toContain(
			ja.verifyEmail.verified,
		)
		expect(q('verify-email-open-app')?.textContent).toContain(
			ja.verifyEmail.openApp,
		)
		expect(q('verify-email-confirm')).toBeNull()
	})

	it('disables the action while the confirmation runs', async () => {
		let finish: () => void = () => {}
		const { rpc, q, confirm, settle } = await render(
			link,
			() =>
				new Promise<void>((resolve) => {
					finish = resolve
				}),
		)
		await confirm()

		const button = q<HTMLButtonElement>('verify-email-confirm')
		expect(button?.disabled).toBe(true)
		button?.click()
		await settle()
		expect(rpc.verifyEmail).toHaveBeenCalledTimes(1)

		finish()
		await settle()
		expect(q('verify-email-verified')).not.toBeNull()
	})

	it('says the link expired or was used, and to resend from Settings, on InvalidArgument', async () => {
		// @spec components/infrastructure/fan/web/route/verify-email "Expired or used link"
		const { q, confirm } = await render(link, async () => {
			throw new ConnectError('not valid', Code.InvalidArgument)
		})
		await confirm()

		const invalid = q('verify-email-invalid')?.textContent
		expect(invalid).toContain(ja.verifyEmail.invalid)
		expect(invalid).toContain(ja.verifyEmail.invalidNext)
		expect(q('verify-email-confirm')).toBeNull()
	})

	it('says to try again later on ResourceExhausted', async () => {
		// @spec components/infrastructure/fan/web/route/verify-email "Too many attempts"
		const { q, confirm } = await render(link, async () => {
			throw new ConnectError('limit', Code.ResourceExhausted)
		})
		await confirm()

		expect(q('verify-email-too-many')?.textContent).toContain(
			ja.verifyEmail.tooMany,
		)
		expect(q('verify-email-confirm')).toBeNull()
	})

	it.each([
		['the server is unavailable', Code.Unavailable],
		['the network fails', Code.Unknown],
	])('says so and offers to try again when %s', async (_, code) => {
		// @spec components/infrastructure/fan/web/route/verify-email "Network failure"
		let calls = 0
		const { rpc, q, confirm } = await render(link, async () => {
			calls++
			if (calls === 1) throw new ConnectError('down', code)
		})
		await confirm()

		expect(q('verify-email-failed')?.textContent).toBe(ja.verifyEmail.failed)
		expect(q('verify-email-confirm')?.textContent).toContain(
			ja.verifyEmail.retry,
		)

		await confirm()
		expect(rpc.verifyEmail).toHaveBeenCalledTimes(2)
		expect(q('verify-email-verified')).not.toBeNull()
	})

	it.each([
		['no code', `user=${USER_ID}`],
		['no User', 'code=AB12CD'],
	])(
		'shows the expired-or-used message and calls nothing for a link with %s',
		async (_, query) => {
			// @spec components/infrastructure/fan/web/route/verify-email "Broken link"
			const { rpc, q } = await render(query)

			expect(q('verify-email-invalid')?.textContent).toContain(
				ja.verifyEmail.invalid,
			)
			expect(q('verify-email-confirm')).toBeNull()
			expect(rpc.verifyEmail).not.toHaveBeenCalled()
		},
	)
})
