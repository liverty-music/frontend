import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, Registration } from 'aurelia'
import { UserManager } from 'oidc-client-ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IUserRpcClient } from '../../src/adapter/rpc/client/user-client'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import type { DeletionBlocker } from '../../src/entities/deletion-blocker'
import { IAnalyticsService } from '../../src/lib/analytics/analytics-service'
import ja from '../../src/locales/ja/translation.json'
import { DeleteAccountRoute } from '../../src/routes/delete-account/delete-account-route'
import { PasskeysCallbackRoute } from '../../src/routes/passkeys-callback/passkeys-callback-route'
import { IAuthService } from '../../src/services/auth-service'
import {
	FreshSignInService,
	IFreshSignInService,
} from '../../src/services/fresh-sign-in-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAnalytics } from '../helpers/mock-analytics'
import { mockFreshSignInUserManager } from '../helpers/mock-fresh-sign-in-user-manager'

vi.mock('oidc-client-ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('oidc-client-ts')>()
	return { ...actual, UserManager: vi.fn() }
})

const FAN_SUB = 'zitadel-user-1'

/** The signed-in fan of the main session. */
function mainAuth() {
	return {
		isAuthenticated: true,
		ready: Promise.resolve(),
		user: { profile: { sub: FAN_SUB, email: 'fan@example.com' } },
		signOutLocally: vi.fn(async () => {}),
	}
}

const TWO_UPCOMING_TICKETS: DeletionBlocker[] = [
	{ kind: 'upcomingTicket', count: 2 },
]

/** Rendered fixtures, stopped after each test so no listener outlives it. */
const mounted: { stop: (dispose?: boolean) => unknown }[] = []

/**
 * The withdrawal screen, end to end on the app's side: the screen, the
 * callback route and the real FreshSignInService over a stand-in
 * oidc-client-ts UserManager (the hosted login itself is not here). Each
 * {@link open} is one opening of the screen: the first, or the one the
 * callback (or the browser's back) leads to.
 */
function setup(blockers: () => Promise<DeletionBlocker[]>) {
	const manager = mockFreshSignInUserManager()
	const auth = mainAuth()
	const users = {
		listDeletionBlockers: vi.fn(blockers),
		delete: vi.fn(async (_idToken: string) => {}),
	}
	const analytics = createMockAnalytics()
	const container = createTestContainer(
		Registration.instance(IAuthService, auth),
	)
	container.register(FreshSignInService)
	const freshSignIn = container.get(IFreshSignInService)

	async function open() {
		const fixture = await createFixture
			.html('<delete-account-route></delete-account-route>')
			.deps(
				I18nConfiguration.customize((options) => {
					options.initOptions = {
						lng: 'ja',
						resources: { ja: { translation: ja } },
						fallbackLng: 'ja',
					}
				}),
				Registration.instance(IAuthService, auth),
				Registration.instance(IFreshSignInService, freshSignIn),
				Registration.instance(IUserRpcClient, users),
				Registration.instance(IAnalyticsService, analytics),
				BusyOnClickCustomAttribute,
				DeleteAccountRoute,
			)
			.build().started
		mounted.push(fixture)
		const host = fixture.appHost
		const vm = CustomElement.for<DeleteAccountRoute>(
			host.querySelector('delete-account-route') as HTMLElement,
		).viewModel
		// The router calls `loading` when the route opens.
		vm.loading()
		await settle()

		const q = <T extends Element>(testId: string) =>
			host.querySelector<T>(`[data-testid="${testId}"]`)
		const blockerLines = () =>
			[...host.querySelectorAll('[data-testid="delete-account-blocker"]')].map(
				(n) => n.textContent?.trim(),
			)
		const dialog = () => q<HTMLDialogElement>('delete-account-confirm')
		return { fixture, host, vm, q, blockerLines, dialog }
	}

	/** Run the callback route the hosted login returns to. */
	const callback = () => container.invoke(PasskeysCallbackRoute).canLoad()

	return { manager, auth, users, analytics, freshSignIn, open, callback }
}

async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0))
	await tasksSettled()
}

describe('Withdrawal screen (fixture)', () => {
	// jsdom implements neither showModal nor close; model them so the dialog's
	// open state and its close (Escape included) can be asserted.
	const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>
	const original = { showModal: proto.showModal, close: proto.close }

	beforeEach(() => {
		vi.mocked(UserManager).mockReset()
		proto.showModal = function (this: HTMLDialogElement) {
			this.setAttribute('open', '')
		}
		proto.close = function (this: HTMLDialogElement) {
			if (!this.hasAttribute('open')) return
			this.removeAttribute('open')
			this.dispatchEvent(new Event('close'))
		}
	})

	afterEach(async () => {
		for (const f of mounted.splice(0)) await f.stop(true)
		proto.showModal = original.showModal
		proto.close = original.close
		sessionStorage.clear()
	})

	/** Open the screen with no blocker and confirm in the dialog. */
	async function confirmFromScreen(app: ReturnType<typeof setup>) {
		const screen = await app.open()
		screen.q<HTMLButtonElement>('delete-account-delete')?.click()
		await settle()
		screen.q<HTMLButtonElement>('delete-account-confirm-delete')?.click()
		await settle()
		return screen
	}

	it('lists an upcoming ticket blocker with its count and offers no delete control', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Fan with an upcoming ticket"
		const app = setup(async () => TWO_UPCOMING_TICKETS)
		const { blockerLines, q } = await app.open()

		expect(blockerLines()).toEqual(['開催前の公演のチケット 2 枚'])
		expect(q('delete-account-blockers')?.textContent).toContain(
			ja.deleteAccount.blockers.note,
		)
		expect(q('delete-account-delete')).toBeNull()
		expect(q('delete-account-statements')).toBeNull()
	})

	it('names every blocker kind in the fan language', async () => {
		const app = setup(async () => [
			{ kind: 'upcomingTicket', count: 2 },
			{ kind: 'listedResale', count: 1 },
			{ kind: 'pendingLotteryEntry', count: 1 },
			{ kind: 'paymentInProgress', count: 1 },
		])
		const { blockerLines } = await app.open()
		expect(blockerLines()).toEqual([
			'開催前の公演のチケット 2 枚',
			'出品中のリセール 1 件',
			'抽選待ちの応募 1 件',
			'手続き中の購入 1 件',
		])
	})

	it('shows a failed read with a retry control and no delete control', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Read fails"
		const app = setup(async () => {
			throw new ConnectError('down', Code.Unavailable)
		})
		const { q, blockerLines } = await app.open()

		expect(q('delete-account-load-error')?.textContent).toContain(
			ja.deleteAccount.loadFailed,
		)
		expect(q('delete-account-retry-load')).not.toBeNull()
		expect(q('delete-account-delete')).toBeNull()

		// Retrying reads again.
		app.users.listDeletionBlockers.mockResolvedValueOnce(TWO_UPCOMING_TICKETS)
		q<HTMLButtonElement>('delete-account-retry-load')?.click()
		await settle()
		expect(app.users.listDeletionBlockers).toHaveBeenCalledTimes(2)
		expect(blockerLines()).toEqual(['開催前の公演のチケット 2 枚'])
	})

	it('states what deletion means, links the Privacy Policy and offers the delete control', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Fan with nothing in progress"
		const app = setup(async () => [])
		const { q, host } = await app.open()

		const statements = q('delete-account-statements')
		const s = ja.deleteAccount.statements
		for (const text of [
			s.removed,
			s.history,
			s.irreversible,
			s.signUpAgain,
			s.records,
		]) {
			expect(statements?.textContent).toContain(text)
		}
		expect(
			q<HTMLAnchorElement>('delete-account-privacy-link')?.getAttribute('href'),
		).toBe('/legal/privacy')
		// The statements come before the delete control.
		const del = q('delete-account-delete')
		expect(del?.textContent).toBe(ja.deleteAccount.delete)
		const items = host.querySelectorAll(
			'[data-testid="delete-account-statement"]',
		)
		expect(items).toHaveLength(5)
		expect(
			items[4].compareDocumentPosition(del as Node) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
	})

	it('deletes once for the fan after the confirmation and a fresh sign-in', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Fan confirms"
		const app = setup(async () => [])
		const screen = await app.open()
		screen.q<HTMLButtonElement>('delete-account-delete')?.click()
		await settle()

		// A modal dialog whose Cancel takes focus first; nothing is asked yet.
		expect(screen.dialog()?.hasAttribute('open')).toBe(true)
		expect(document.activeElement).toBe(
			screen.q('delete-account-confirm-cancel'),
		)
		expect(app.manager.signinRedirect).not.toHaveBeenCalled()

		screen.q<HTMLButtonElement>('delete-account-confirm-delete')?.click()
		await settle()

		// Off to the hosted login, the same fresh sign-in passkeys use.
		expect(app.manager.signinRedirect).toHaveBeenCalledTimes(1)
		expect(app.manager.signinRedirect).toHaveBeenCalledWith(
			expect.objectContaining({
				max_age: 300,
				login_hint: 'fan@example.com',
				state: { returnTo: 'deleteAccount' },
			}),
		)
		expect(app.users.delete).not.toHaveBeenCalled()

		// The fan signs in again with their passkey; the callback returns here.
		app.manager.signInAs(FAN_SUB)
		expect(await app.callback()).toBe('/settings/delete-account')
		await app.open()

		expect(app.users.delete).toHaveBeenCalledTimes(1)
		expect(app.users.delete).toHaveBeenCalledWith('fresh-id-token')
	})

	it('closes the dialog on Escape without asking for a sign-in or deleting', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Fan cancels"
		const app = setup(async () => [])
		const screen = await app.open()
		screen.q<HTMLButtonElement>('delete-account-delete')?.click()
		await settle()
		const dialog = screen.dialog()
		expect(dialog?.hasAttribute('open')).toBe(true)

		// A browser closes a modal dialog on Escape; the stubbed close() does
		// the same.
		dialog?.close()
		await settle()

		expect(dialog?.hasAttribute('open')).toBe(false)
		expect(app.manager.signinRedirect).not.toHaveBeenCalled()
		expect(app.users.delete).not.toHaveBeenCalled()
	})

	it('closes the dialog on Cancel without asking for a sign-in or deleting', async () => {
		const app = setup(async () => [])
		const screen = await app.open()
		screen.q<HTMLButtonElement>('delete-account-delete')?.click()
		await settle()
		screen.q<HTMLButtonElement>('delete-account-confirm-cancel')?.click()
		await settle()

		expect(screen.dialog()?.hasAttribute('open')).toBe(false)
		expect(app.manager.signinRedirect).not.toHaveBeenCalled()
		expect(app.users.delete).not.toHaveBeenCalled()
	})

	it('says the account was not deleted when the fan comes back without signing in', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Fresh sign-in abandoned"
		const app = setup(async () => [])
		await confirmFromScreen(app)
		expect(app.manager.signinRedirect).toHaveBeenCalledTimes(1)

		// The fan leaves the hosted login with the browser's back: the screen
		// loads again without the callback.
		const back = await app.open()
		expect(back.q('delete-account-not-deleted')?.textContent).toBe(
			ja.deleteAccount.notDeleted,
		)
		expect(app.users.delete).not.toHaveBeenCalled()
		// The delete control is offered again.
		expect(back.q('delete-account-delete')).not.toBeNull()
	})

	it('says the account was not deleted when the page comes back from the bfcache', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Fresh sign-in abandoned"
		const app = setup(async () => [])
		const screen = await confirmFromScreen(app)
		expect(screen.q('delete-account-not-deleted')).toBeNull()

		window.dispatchEvent(
			new PageTransitionEvent('pageshow', { persisted: true }),
		)
		await settle()

		expect(screen.q('delete-account-not-deleted')?.textContent).toBe(
			ja.deleteAccount.notDeleted,
		)
		expect(app.users.delete).not.toHaveBeenCalled()
	})

	it('says the account was not deleted when the hosted login returns an error', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Fresh sign-in abandoned"
		const app = setup(async () => [])
		await confirmFromScreen(app)
		app.manager.signinCallback.mockRejectedValueOnce(new Error('access_denied'))
		// The withdrawal screen, not the callback, says what happened.
		expect(await app.callback()).toBe('/settings/delete-account')

		const back = await app.open()
		expect(back.q('delete-account-not-deleted')).not.toBeNull()
		expect(app.users.delete).not.toHaveBeenCalled()
	})

	it('does not delete when the fresh sign-in names another account', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Different account"
		const app = setup(async () => [])
		await confirmFromScreen(app)
		app.manager.signInAs('someone-else')
		expect(await app.callback()).toBe('/settings/delete-account')

		const back = await app.open()
		expect(app.users.delete).not.toHaveBeenCalled()
		expect(back.q('delete-account-not-deleted')?.textContent).toBe(
			ja.deleteAccount.notDeleted,
		)
		expect(app.freshSignIn.sessionFor('deleteAccount')).toBeNull()
	})

	it('signs the fan out on this device, resets analytics and shows the deleted view', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Deletion succeeds"
		const app = setup(async () => [])
		await confirmFromScreen(app)
		app.manager.signInAs(FAN_SUB)
		await app.callback()
		const back = await app.open()

		expect(app.users.delete).toHaveBeenCalledTimes(1)
		expect(app.auth.signOutLocally).toHaveBeenCalledTimes(1)
		expect(app.analytics.reset).toHaveBeenCalledTimes(1)
		// The proof is dropped once the call returns.
		expect(app.freshSignIn.sessionFor('deleteAccount')).toBeNull()

		expect(back.q('delete-account-deleted')?.textContent).toContain(
			ja.deleteAccount.deleted.title,
		)
		expect(
			back
				.q<HTMLAnchorElement>('delete-account-to-welcome')
				?.getAttribute('href'),
		).toBe('/welcome')
		expect(back.q('delete-account-delete')).toBeNull()
	})

	it('lists the new blocker when deletion is refused because of a ticket bought meanwhile', async () => {
		// @spec components/infrastructure/fan/web/route/delete-account "Ticket bought in another tab"
		const app = setup(async () => [])
		await confirmFromScreen(app)
		app.manager.signInAs(FAN_SUB)
		await app.callback()
		app.users.delete.mockRejectedValueOnce(
			new ConnectError('blocked', Code.FailedPrecondition),
		)
		app.users.listDeletionBlockers.mockResolvedValueOnce([
			{ kind: 'upcomingTicket', count: 1 },
		])
		const back = await app.open()

		expect(back.blockerLines()).toEqual(['開催前の公演のチケット 1 枚'])
		expect(back.q('delete-account-delete')).toBeNull()
		expect(app.auth.signOutLocally).not.toHaveBeenCalled()
		expect(app.freshSignIn.sessionFor('deleteAccount')).toBeNull()
	})

	it('shows any other failure with a retry that signs in again, and keeps the fan signed in', async () => {
		const app = setup(async () => [])
		await confirmFromScreen(app)
		app.manager.signInAs(FAN_SUB)
		await app.callback()
		app.users.delete.mockRejectedValueOnce(
			new ConnectError('down', Code.Unavailable),
		)
		const back = await app.open()

		expect(back.q('delete-account-failed')?.textContent).toContain(
			ja.deleteAccount.deleteFailed,
		)
		expect(app.auth.signOutLocally).not.toHaveBeenCalled()
		expect(app.analytics.reset).not.toHaveBeenCalled()

		back.q<HTMLButtonElement>('delete-account-retry-delete')?.click()
		await settle()
		expect(app.manager.signinRedirect).toHaveBeenCalledTimes(2)
		expect(app.manager.signinRedirect).toHaveBeenLastCalledWith(
			expect.objectContaining({ state: { returnTo: 'deleteAccount' } }),
		)
	})

	it('drops the proof when the fan leaves the screen', async () => {
		const app = setup(async () => [])
		app.manager.signInAs(FAN_SUB)
		await app.freshSignIn.handleCallback()
		const screen = await app.open()
		screen.vm.unloading()
		expect(app.freshSignIn.sessionFor('deleteAccount')).toBeNull()
	})

	it('sends a guest back to Settings', async () => {
		const container = createTestContainer(
			Registration.instance(IAuthService, {
				...mainAuth(),
				isAuthenticated: false,
			}),
			Registration.instance(IUserRpcClient, {}),
			Registration.instance(IAnalyticsService, createMockAnalytics()),
		)
		mockFreshSignInUserManager()
		container.register(FreshSignInService)
		expect(await container.invoke(DeleteAccountRoute).canLoad()).toBe(
			'/settings',
		)
	})
})
