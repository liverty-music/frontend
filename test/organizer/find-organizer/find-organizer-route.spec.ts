import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The screen resolves IOrganizerClient; replace the real module (which builds
// Connect transports) with a fresh token so the fixture binds to the double.
const IOrganizerClient = DI.createInterface('IOrganizerClient')
vi.mock('../../../organizer/services/organizer-client', () => ({
	IOrganizerClient,
}))

const { FindOrganizerRoute } = await import(
	'../../../organizer/find-organizer/find-organizer-route'
)
const { ConsoleI18nConfiguration } = await import(
	'../../../organizer/i18n/console-language'
)
const { ConsoleFormatters } = await import('../../../organizer/i18n/converters')
// Only the components the screen uses: importing the whole console kit would
// instrument every component for coverage without testing it.
const { ConsoleButton } = await import(
	'../../../organizer/ui/console-button/console-button'
)
const { ConsoleField } = await import(
	'../../../organizer/ui/console-field/console-field'
)
const { ConsoleIcon } = await import(
	'../../../organizer/ui/console-icon/console-icon'
)

type Route = InstanceType<typeof FindOrganizerRoute>

const SENT_JA =
	'このアドレスで Liverty Music の主催者を運営している場合は、サインイン用のリンクをメールでお送りしました。'

async function mount(sendSignInLinks: ReturnType<typeof vi.fn>) {
	const fixture = createFixture(
		'<find-organizer-route></find-organizer-route>',
		class {},
		[
			ConsoleI18nConfiguration,
			...ConsoleFormatters,
			ConsoleButton,
			ConsoleField,
			ConsoleIcon,
			FindOrganizerRoute,
			Registration.instance(IOrganizerClient, { sendSignInLinks }),
		],
	)
	await fixture.startPromise
	await tasksSettled()
	const host = fixture.appHost.querySelector('find-organizer-route')
	if (!host) throw new Error('find-organizer-route did not render')
	const vm = CustomElement.for<Route>(host).viewModel
	const send = async (email: string) => {
		vm.email = email
		await vm.send()
		await tasksSettled()
	}
	return { fixture, vm, host, send }
}

/** The text of the screen's outcome line. */
function outcomeText(host: Element): string {
	return host.querySelector('.outcome')?.textContent?.trim() ?? ''
}

describe('find-organizer screen', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('asks for the email and shows no Organizer, Organization or sign-in form', async () => {
		const { fixture, host } = await mount(vi.fn())
		expect(host.textContent).toContain('主催者として使っているメールアドレス')
		expect(host.querySelectorAll('console-field')).toHaveLength(1)
		expect(host.querySelector('input[type="password"]')).toBeNull()
		expect(outcomeText(host)).toBe('')
		await fixture.tearDown()
	})

	// @spec components/infrastructure/organizer/web/route/find-organizer "Owner asks for the link"
	it('sends the trimmed email and says a link has been sent if it runs an Organizer', async () => {
		const sendSignInLinks = vi.fn().mockResolvedValue(undefined)
		const { fixture, host, vm, send } = await mount(sendSignInLinks)

		await send('  owner@xx-records.example  ')

		expect(sendSignInLinks).toHaveBeenCalledWith('owner@xx-records.example')
		expect(vm.emailError).toBeNull()
		expect(outcomeText(host)).toContain(SENT_JA)
		expect(outcomeText(host)).toContain('Liverty Music にお問い合わせください')
		await fixture.tearDown()
	})

	// @spec components/infrastructure/organizer/web/route/find-organizer "Address that runs nothing"
	it('answers an address that runs nothing exactly as it answers an owner', async () => {
		// SendSignInLinks answers the same empty success for both addresses.
		const sendSignInLinks = vi.fn().mockResolvedValue(undefined)
		const owner = await mount(sendSignInLinks)
		await owner.send('owner@xx-records.example')
		const ownerText = outcomeText(owner.host)
		await owner.fixture.tearDown()

		const nobody = await mount(sendSignInLinks)
		await nobody.send('nobody@example.com')

		expect(outcomeText(nobody.host)).toBe(ownerText)
		await nobody.fixture.tearDown()
	})

	// @spec components/infrastructure/organizer/web/route/find-organizer "Malformed address"
	it('says the address is not valid next to the field and sends nothing', async () => {
		const sendSignInLinks = vi.fn()
		const { fixture, host, vm, send } = await mount(sendSignInLinks)

		await send('band@')

		expect(sendSignInLinks).not.toHaveBeenCalled()
		expect(vm.emailError).toBe('findOrganizer.emailInvalid')
		const field = host.querySelector('console-field')
		expect(field?.shadowRoot?.textContent).toContain(
			'メールアドレスの形式が正しくありません。',
		)
		expect(outcomeText(host)).toBe('')
		await fixture.tearDown()
	})

	it('refuses an email over 165 characters before sending', async () => {
		const sendSignInLinks = vi.fn()
		const { fixture, vm, send } = await mount(sendSignInLinks)

		await send(`${'a'.repeat(154)}@example.com`)

		expect(sendSignInLinks).not.toHaveBeenCalled()
		expect(vm.emailError).toEqual({
			key: 'findOrganizer.emailTooLong',
			params: { max: 165 },
		})
		await fixture.tearDown()
	})

	it('shows the server refusing the address next to the field', async () => {
		const sendSignInLinks = vi
			.fn()
			.mockRejectedValue(new ConnectError('invalid', Code.InvalidArgument))
		const { fixture, vm, host, send } = await mount(sendSignInLinks)

		await send('owner@xx-records.example')

		expect(vm.emailError).toBe('findOrganizer.emailInvalid')
		expect(outcomeText(host)).toBe('')
		await fixture.tearDown()
	})

	// @spec components/infrastructure/organizer/web/route/find-organizer "Too many requests"
	it('says to try again later when SendSignInLinks fails with ResourceExhausted', async () => {
		const sendSignInLinks = vi
			.fn()
			.mockRejectedValue(
				new ConnectError('rate limited', Code.ResourceExhausted),
			)
		const { fixture, host, send } = await mount(sendSignInLinks)

		await send('owner@xx-records.example')

		expect(outcomeText(host)).toBe(
			'リクエストが多すぎます。しばらくしてから、もう一度お試しください。',
		)
		await fixture.tearDown()
	})

	it('says the link could not be sent on any other failure', async () => {
		const sendSignInLinks = vi
			.fn()
			.mockRejectedValue(new ConnectError('down', Code.Unavailable))
		const { fixture, host, send } = await mount(sendSignInLinks)

		await send('owner@xx-records.example')

		expect(outcomeText(host)).toBe(
			'リンクを送れませんでした。もう一度お試しください。',
		)
		await fixture.tearDown()
	})
})
