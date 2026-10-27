import { createFixture } from '@aurelia/testing'
import {
	type DeletionBlocker,
	DeletionBlocker_Kind,
	DeletionBlockerSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/deletion_blocker_pb.js'
import {
	type User,
	UserSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Replace the real client module (which would build a Connect transport) with
// a fresh interface token so the fixture binds to the test double.
const IAdminUserClient = DI.createInterface('IAdminUserClient')
vi.mock('../../../admin/services/user-client', () => ({ IAdminUserClient }))

const { UsersRoute } = await import('../../../admin/users/users-route')

const ROUTE_SPEC = 'components/infrastructure/admin/web/route/users'

function makeUser(): User {
	return create(UserSchema, {
		id: { value: '018f0000-0000-7000-8000-000000000001' },
		email: { value: 'fan@example.com' },
		name: 'Hanako',
	})
}

function blocker(kind: DeletionBlocker_Kind, count: number): DeletionBlocker {
	return create(DeletionBlockerSchema, { kind, count })
}

interface MockClient {
	getByEmail: ReturnType<typeof vi.fn>
	delete: ReturnType<typeof vi.fn>
}

function mockClient(blockers: DeletionBlocker[] = []): MockClient {
	return {
		getByEmail: vi.fn().mockResolvedValue({ user: makeUser(), blockers }),
		delete: vi.fn().mockResolvedValue(undefined),
	}
}

async function build(client: MockClient) {
	const fixture = createFixture
		.html('<users-route component.ref="route"></users-route>')
		.deps(UsersRoute, Registration.instance(IAdminUserClient, client))
		.build()
	await fixture.started
	return fixture
}

type Fixture = Awaited<ReturnType<typeof build>>

function routeOf(fixture: Fixture): InstanceType<typeof UsersRoute> {
	return (fixture.component as { route: InstanceType<typeof UsersRoute> }).route
}

const q = <T extends Element>(fixture: Fixture, testId: string) =>
	fixture.appHost.querySelector<T>(`[data-testid="${testId}"]`)

function dialogOf(fixture: Fixture): HTMLDialogElement {
	const dialog = q<HTMLDialogElement>(fixture, 'users-dialog')
	if (!dialog) throw new Error('delete dialog not rendered')
	return dialog
}

function dialogButton(fixture: Fixture, label: string): HTMLButtonElement {
	const button = [
		...dialogOf(fixture).querySelectorAll<HTMLButtonElement>('button'),
	].find((b) => b.textContent?.trim() === label)
	if (!button) throw new Error(`dialog button ${label} not rendered`)
	return button
}

/** Type an address into the field and submit it, the way the admin does. */
async function lookUp(fixture: Fixture, email: string) {
	const input = fixture.appHost.querySelector<HTMLInputElement>(
		'input[type="email"]',
	)
	if (!input) throw new Error('email field not rendered')
	input.value = email
	input.dispatchEvent(new Event('input'))
	fixture.appHost
		.querySelector('form')
		?.dispatchEvent(new Event('submit', { cancelable: true }))
	await vi.waitFor(() => expect(routeOf(fixture).phase).not.toBe('loading'))
	await fixture.tasksSettled
}

describe('UsersRoute', () => {
	// jsdom implements neither showModal nor close; model them so the dialog's
	// open state and its close event (Escape included) can be asserted.
	const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>
	const original = { showModal: proto.showModal, close: proto.close }

	beforeEach(() => {
		vi.clearAllMocks()
		proto.showModal = function (this: HTMLDialogElement) {
			this.setAttribute('open', '')
		}
		proto.close = function (this: HTMLDialogElement) {
			if (!this.hasAttribute('open')) return
			this.removeAttribute('open')
			this.dispatchEvent(new Event('close'))
		}
	})

	afterEach(() => {
		proto.showModal = original.showModal
		proto.close = original.close
	})

	it(`@spec ${ROUTE_SPEC} "Registered fan"`, async () => {
		const client = mockClient([blocker(DeletionBlocker_Kind.LISTED_RESALE, 1)])
		const fixture = await build(client)
		await lookUp(fixture, 'fan@example.com')

		expect(client.getByEmail).toHaveBeenCalledWith('fan@example.com')
		const detail = q(fixture, 'users-detail')
		expect(detail?.textContent).toContain('Hanako')
		expect(q(fixture, 'users-email')?.textContent).toBe('fan@example.com')
		expect(q(fixture, 'users-id')?.textContent).toBe(
			'018f0000-0000-7000-8000-000000000001',
		)
		expect(q(fixture, 'users-blocker')?.textContent?.trim()).toBe(
			'Resale listings on sale: 1',
		)
		// Only the User found is shown.
		expect(
			fixture.appHost.querySelectorAll('[data-testid="users-detail"]'),
		).toHaveLength(1)
	})

	it('shows a found fan with no blocker as deletable', async () => {
		const fixture = await build(mockClient())
		await lookUp(fixture, 'fan@example.com')
		expect(q(fixture, 'users-no-blocker')).not.toBeNull()
		expect(q(fixture, 'users-delete')).not.toBeNull()
	})

	it(`@spec ${ROUTE_SPEC} "Unregistered address"`, async () => {
		const client = mockClient()
		client.getByEmail.mockRejectedValueOnce(
			new ConnectError('no user', Code.NotFound),
		)
		const fixture = await build(client)
		await lookUp(fixture, 'nobody@example.com')

		expect(q(fixture, 'users-not-found')?.textContent?.trim()).toBe(
			'No account has that address.',
		)
		expect(q(fixture, 'users-delete')).toBeNull()
		expect(q(fixture, 'users-detail')).toBeNull()
	})

	it('shows any other lookup failure with copy the console owns', async () => {
		const client = mockClient()
		client.getByEmail.mockRejectedValueOnce(
			new ConnectError('db: connection reset', Code.Internal),
		)
		const fixture = await build(client)
		await lookUp(fixture, 'fan@example.com')

		expect(q(fixture, 'users-lookup-error')?.textContent?.trim()).toBe(
			'Failed to look up the account.',
		)
		expect(fixture.appHost.textContent).not.toContain('connection reset')
	})

	it('checks the address before sending it', async () => {
		const client = mockClient()
		const fixture = await build(client)
		await lookUp(fixture, 'not-an-address')

		expect(client.getByEmail).not.toHaveBeenCalled()
		expect(routeOf(fixture).emailError).toBe('Enter a valid email address.')
	})

	it(`@spec ${ROUTE_SPEC} "Fan with an upcoming ticket"`, async () => {
		const fixture = await build(
			mockClient([blocker(DeletionBlocker_Kind.UPCOMING_TICKET, 2)]),
		)
		await lookUp(fixture, 'fan@example.com')

		expect(q(fixture, 'users-blocker')?.textContent?.trim()).toBe(
			'Tickets for upcoming concerts: 2',
		)
		expect(q(fixture, 'users-delete')).toBeNull()
	})

	it(`@spec ${ROUTE_SPEC} "Admin confirms"`, async () => {
		let resolveDelete: () => void = () => {}
		const client = mockClient()
		client.delete.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveDelete = resolve
				}),
		)
		const fixture = await build(client)
		await lookUp(fixture, 'fan@example.com')
		q<HTMLButtonElement>(fixture, 'users-delete')?.click()
		await fixture.tasksSettled

		// The dialog names the User and says what stays; Cancel takes focus.
		const dialog = dialogOf(fixture)
		expect(dialog.hasAttribute('open')).toBe(true)
		expect(dialog.textContent).toContain('Hanako')
		expect(dialog.textContent).toContain('fan@example.com')
		expect(dialog.textContent).toContain('permanently')
		expect(dialog.textContent).toContain('Order and ticket records remain')
		expect(document.activeElement).toBe(dialogButton(fixture, 'Cancel'))
		expect(client.delete).not.toHaveBeenCalled()

		const confirm = dialogButton(fixture, 'Delete')
		confirm.click()
		await fixture.tasksSettled
		// In flight: the control is disabled and a second activation sends nothing.
		expect(dialogButton(fixture, 'Deleting…').disabled).toBe(true)
		confirm.click()
		resolveDelete()
		await vi.waitFor(() => expect(routeOf(fixture).deleting).toBe(false))

		expect(client.delete).toHaveBeenCalledTimes(1)
		expect(client.delete).toHaveBeenCalledWith(
			'018f0000-0000-7000-8000-000000000001',
		)
	})

	it(`@spec ${ROUTE_SPEC} "Admin cancels"`, async () => {
		const client = mockClient()
		const fixture = await build(client)
		await lookUp(fixture, 'fan@example.com')
		q<HTMLButtonElement>(fixture, 'users-delete')?.click()
		await fixture.tasksSettled
		const dialog = dialogOf(fixture)
		expect(dialog.hasAttribute('open')).toBe(true)

		// A browser closes a modal dialog on Escape and fires `close`; the
		// stubbed close() does the same.
		dialog.close()
		await fixture.tasksSettled

		expect(dialog.hasAttribute('open')).toBe(false)
		expect(routeOf(fixture).dialogOpen).toBe(false)
		// A Delete activation after the dialog closed sends nothing.
		await routeOf(fixture).confirmDelete()
		expect(client.delete).not.toHaveBeenCalled()
		expect(q(fixture, 'users-detail')).not.toBeNull()
	})

	it(`@spec ${ROUTE_SPEC} "Deleted"`, async () => {
		const fixture = await build(mockClient())
		await lookUp(fixture, 'fan@example.com')
		q<HTMLButtonElement>(fixture, 'users-delete')?.click()
		await fixture.tasksSettled
		dialogButton(fixture, 'Delete').click()
		await vi.waitFor(() => expect(routeOf(fixture).deleting).toBe(false))
		await fixture.tasksSettled

		expect(q(fixture, 'users-deleted')?.textContent?.trim()).toBe(
			'The account of fan@example.com was deleted.',
		)
		expect(q(fixture, 'users-detail')).toBeNull()
		expect(dialogOf(fixture).hasAttribute('open')).toBe(false)
	})

	it(`@spec ${ROUTE_SPEC} "Blocker appeared meanwhile"`, async () => {
		const client = mockClient()
		client.delete.mockRejectedValueOnce(
			new ConnectError('blocked', Code.FailedPrecondition),
		)
		const fixture = await build(client)
		await lookUp(fixture, 'fan@example.com')
		client.getByEmail.mockResolvedValueOnce({
			user: makeUser(),
			blockers: [blocker(DeletionBlocker_Kind.PAYMENT_IN_PROGRESS, 1)],
		})
		q<HTMLButtonElement>(fixture, 'users-delete')?.click()
		await fixture.tasksSettled
		dialogButton(fixture, 'Delete').click()
		await vi.waitFor(() => expect(routeOf(fixture).deleting).toBe(false))
		await fixture.tasksSettled

		expect(client.getByEmail).toHaveBeenCalledTimes(2)
		expect(q(fixture, 'users-blocker')?.textContent?.trim()).toBe(
			'Purchases being paid: 1',
		)
		expect(q(fixture, 'users-delete')).toBeNull()
	})

	it('keeps the User shown with the error when Delete fails otherwise', async () => {
		const client = mockClient()
		client.delete.mockRejectedValueOnce(
			new ConnectError('identity: timeout', Code.Unavailable),
		)
		const fixture = await build(client)
		await lookUp(fixture, 'fan@example.com')
		q<HTMLButtonElement>(fixture, 'users-delete')?.click()
		await fixture.tasksSettled
		dialogButton(fixture, 'Delete').click()
		await vi.waitFor(() => expect(routeOf(fixture).deleting).toBe(false))
		await fixture.tasksSettled

		expect(q(fixture, 'users-delete-error')?.textContent?.trim()).toBe(
			'Failed to delete the account.',
		)
		expect(fixture.appHost.textContent).not.toContain('identity: timeout')
		expect(q(fixture, 'users-detail')).not.toBeNull()
	})
})
