import { createFixture } from '@aurelia/testing'
import {
	type Organizer,
	OrganizerSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Replace the real client module (which builds a Connect transport) with a
// fresh interface token so the fixture binds to the test double.
const IOrganizerClient = DI.createInterface('IOrganizerClient')

vi.mock('../../../admin/services/organizer-client', () => ({
	IOrganizerClient,
}))

const { OrganizerCommercialTerms } = await import(
	'../../../admin/organizers/organizer-commercial-terms/organizer-commercial-terms'
)

type Vm = InstanceType<typeof OrganizerCommercialTerms>

interface MockOrganizerClient {
	get: ReturnType<typeof vi.fn>
	setBusinessDetails: ReturnType<typeof vi.fn>
	setPlatformFeeRate: ReturnType<typeof vi.fn>
}

const DETAILS = {
	legalName: 'Liverty Records Inc.',
	representativeName: 'Taro Yamada',
	businessAddress: '1-2-3 Shibuya, Shibuya-ku, Tokyo',
	businessPhoneNumber: '+81312345678',
	contactEmail: 'contact@liverty.example',
}

function makeOrganizer(
	init: { bps?: number; details?: typeof DETAILS } = {},
): Organizer {
	return create(OrganizerSchema, {
		id: { value: 'o1' },
		name: { value: 'Org One' },
		...(init.details
			? {
					legalName: { value: init.details.legalName },
					representativeName: { value: init.details.representativeName },
					businessAddress: { value: init.details.businessAddress },
					businessPhoneNumber: { value: init.details.businessPhoneNumber },
					contactEmail: { value: init.details.contactEmail },
				}
			: {}),
		platformFeeRateBps: init.bps ?? 800,
	})
}

function createMockClient(
	overrides: Partial<MockOrganizerClient> = {},
): MockOrganizerClient {
	return {
		get: vi.fn().mockResolvedValue(makeOrganizer()),
		setBusinessDetails: vi.fn(),
		setPlatformFeeRate: vi.fn(),
		...overrides,
	}
}

async function build(client: MockOrganizerClient) {
	const fixture = createFixture
		.html(
			'<organizer-commercial-terms organizer-id="o1" component.ref="vm"></organizer-commercial-terms>',
		)
		.deps(
			OrganizerCommercialTerms,
			Registration.instance(IOrganizerClient, client),
		)
		.build()
	await fixture.started
	return fixture
}

function vmOf(fixture: Awaited<ReturnType<typeof build>>): Vm {
	return (fixture.component as { vm: Vm }).vm
}

/** Fields with an error message; bound fields may be present as `undefined`. */
function fieldsWithErrors(vm: Vm): string[] {
	return Object.entries(vm.businessErrors)
		.filter(([, message]) => message !== undefined)
		.map(([field]) => field)
		.sort()
}

function inputValue(
	fixture: Awaited<ReturnType<typeof build>>,
	name: string,
): string {
	const input = fixture.appHost.querySelector<HTMLInputElement>(
		`input[name="${name}"]`,
	)
	if (!input) throw new Error(`input ${name} not rendered`)
	return input.value
}

describe('OrganizerCommercialTerms', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('prefill', () => {
		it('prefills both forms from Get', async () => {
			const client = createMockClient({
				get: vi
					.fn()
					.mockResolvedValue(makeOrganizer({ bps: 500, details: DETAILS })),
			})
			const fixture = await build(client)
			const vm = vmOf(fixture)

			expect(client.get).toHaveBeenCalledWith('o1')
			expect(vm.phase).toBe('ready')
			expect(vm.business).toEqual(DETAILS)
			expect(vm.hasBusinessDetails).toBe(true)
			expect(vm.feeRateText).toBe('5.00')
			expect(inputValue(fixture, 'legalName')).toBe(DETAILS.legalName)
			expect(inputValue(fixture, 'businessPhoneNumber')).toBe(
				DETAILS.businessPhoneNumber,
			)
			expect(inputValue(fixture, 'platformFeeRate')).toBe('5.00')
			expect(fixture.appHost.textContent).not.toContain('Not entered yet')
		})

		it('shows empty business detail fields and the not-entered note when details are absent', async () => {
			const fixture = await build(createMockClient())
			const vm = vmOf(fixture)

			expect(vm.hasBusinessDetails).toBe(false)
			expect(vm.business.legalName).toBe('')
			expect(vm.feeRateText).toBe('8.00')
			expect(fixture.appHost.textContent).toContain('Not entered yet')
		})

		it('reloads when the organizer id changes', async () => {
			const client = createMockClient()
			const fixture = await build(client)
			const vm = vmOf(fixture)

			client.get.mockResolvedValueOnce(makeOrganizer({ bps: 3000 }))
			vm.organizerId = 'o2'
			await vi.waitFor(() => expect(vm.feeRateText).toBe('30.00'))
			expect(client.get).toHaveBeenLastCalledWith('o2')
		})

		it('surfaces a Get failure with a retry', async () => {
			const client = createMockClient({
				get: vi.fn().mockRejectedValue(new ConnectError('gone', Code.NotFound)),
			})
			const fixture = await build(client)
			const vm = vmOf(fixture)

			expect(vm.phase).toBe('error')
			expect(vm.loadError).toBe('The organizer or artist no longer exists.')
			expect(fixture.appHost.textContent).toContain('Retry')
		})
	})

	describe('business details', () => {
		it('shows field errors and does not save invalid details', async () => {
			const client = createMockClient()
			const fixture = await build(client)
			const vm = vmOf(fixture)

			vm.business.legalName = DETAILS.legalName
			vm.business.representativeName = DETAILS.representativeName
			vm.business.businessAddress = DETAILS.businessAddress
			vm.business.businessPhoneNumber = '03-1234-5678'
			vm.business.contactEmail = 'not-an-email'
			await vm.saveBusinessDetails()
			await fixture.tasksSettled

			expect(client.setBusinessDetails).not.toHaveBeenCalled()
			expect(fieldsWithErrors(vm)).toEqual([
				'businessPhoneNumber',
				'contactEmail',
			])
			const phoneError = fixture.appHost.querySelector(
				'#business-phone-number-error',
			)
			expect(phoneError?.textContent).toContain('+81312345678')
			expect(
				fixture.appHost
					.querySelector('input[name="businessPhoneNumber"]')
					?.getAttribute('aria-invalid'),
			).toBe('true')
			expect(
				fixture.appHost.querySelector('#business-contact-email-error')
					?.textContent,
			).toContain('valid email')
		})

		it('requires every field', async () => {
			const client = createMockClient()
			const vm = vmOf(await build(client))

			await vm.saveBusinessDetails()

			expect(client.setBusinessDetails).not.toHaveBeenCalled()
			expect(fieldsWithErrors(vm)).toHaveLength(5)
		})

		it('saves trimmed details and shows the values the server returns', async () => {
			const stored = { ...DETAILS, legalName: 'Liverty Records K.K.' }
			const client = createMockClient({
				setBusinessDetails: vi
					.fn()
					.mockResolvedValue(makeOrganizer({ details: stored })),
			})
			const fixture = await build(client)
			const vm = vmOf(fixture)

			vm.business.legalName = `  ${DETAILS.legalName}  `
			vm.business.representativeName = DETAILS.representativeName
			vm.business.businessAddress = DETAILS.businessAddress
			vm.business.businessPhoneNumber = DETAILS.businessPhoneNumber
			vm.business.contactEmail = DETAILS.contactEmail
			vm.feeRateText = '12.50'
			await vm.saveBusinessDetails()
			await fixture.tasksSettled

			expect(client.setBusinessDetails).toHaveBeenCalledWith('o1', DETAILS)
			expect(vm.business).toEqual(stored)
			expect(vm.hasBusinessDetails).toBe(true)
			expect(vm.businessSaved).toBe(true)
			expect(inputValue(fixture, 'legalName')).toBe('Liverty Records K.K.')
			// An unsaved edit in the other form survives.
			expect(vm.feeRateText).toBe('12.50')
		})

		it('reads the organizer with Get when the response carries none', async () => {
			const client = createMockClient({
				setBusinessDetails: vi.fn().mockResolvedValue(undefined),
			})
			const vm = vmOf(await build(client))
			client.get.mockResolvedValueOnce(makeOrganizer({ details: DETAILS }))

			Object.assign(vm.business, DETAILS)
			await vm.saveBusinessDetails()

			expect(client.get).toHaveBeenCalledTimes(2)
			expect(vm.business).toEqual(DETAILS)
			expect(vm.businessSaved).toBe(true)
		})

		it('routes a FailedPrecondition through the organizer error copy', async () => {
			const client = createMockClient({
				setBusinessDetails: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('deactivated', Code.FailedPrecondition),
					),
			})
			const fixture = await build(client)
			const vm = vmOf(fixture)

			Object.assign(vm.business, DETAILS)
			await vm.saveBusinessDetails()
			await fixture.tasksSettled

			expect(vm.businessSaved).toBe(false)
			expect(vm.businessSaveError).toBe(
				'This organizer is deactivated and can no longer be changed.',
			)
			expect(fixture.appHost.textContent).toContain('deactivated')
		})
	})

	describe('platform fee rate', () => {
		it('shows a field error and does not save an out-of-range rate', async () => {
			const client = createMockClient()
			const fixture = await build(client)
			const vm = vmOf(fixture)

			vm.feeRateText = '30.01'
			await vm.saveFeeRate()
			await fixture.tasksSettled

			expect(client.setPlatformFeeRate).not.toHaveBeenCalled()
			expect(
				fixture.appHost.querySelector('#fee-rate-error')?.textContent,
			).toContain('between 0% and 30%')
		})

		it('does not save a rate with more than two decimals', async () => {
			const client = createMockClient()
			const vm = vmOf(await build(client))

			vm.feeRateText = '5.001'
			await vm.saveFeeRate()

			expect(client.setPlatformFeeRate).not.toHaveBeenCalled()
			expect(vm.feeRateError).toContain('two decimals')
		})

		it('saves the rate in basis points and shows the returned rate', async () => {
			const client = createMockClient({
				setPlatformFeeRate: vi
					.fn()
					.mockResolvedValue(makeOrganizer({ bps: 500 })),
			})
			const fixture = await build(client)
			const vm = vmOf(fixture)

			vm.business.legalName = 'unsaved edit'
			vm.feeRateText = '5'
			await vm.saveFeeRate()
			await fixture.tasksSettled

			expect(client.setPlatformFeeRate).toHaveBeenCalledWith('o1', 500)
			expect(vm.feeRateText).toBe('5.00')
			expect(vm.feeRateSaved).toBe(true)
			expect(inputValue(fixture, 'platformFeeRate')).toBe('5.00')
			// An unsaved edit in the other form survives.
			expect(vm.business.legalName).toBe('unsaved edit')
		})

		it('saves the 30% maximum as 3000 bps', async () => {
			const client = createMockClient({
				setPlatformFeeRate: vi
					.fn()
					.mockResolvedValue(makeOrganizer({ bps: 3000 })),
			})
			const vm = vmOf(await build(client))

			vm.feeRateText = '30.00'
			await vm.saveFeeRate()

			expect(client.setPlatformFeeRate).toHaveBeenCalledWith('o1', 3000)
			expect(vm.feeRateText).toBe('30.00')
		})

		it('surfaces an RPC error instead of swallowing it', async () => {
			const client = createMockClient({
				setPlatformFeeRate: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('rate out of range', Code.InvalidArgument),
					),
			})
			const fixture = await build(client)
			const vm = vmOf(fixture)

			vm.feeRateText = '5.00'
			await vm.saveFeeRate()
			await fixture.tasksSettled

			expect(vm.feeRateSaved).toBe(false)
			expect(vm.feeRateSaveError).toBe('rate out of range')
			expect(fixture.appHost.textContent).toContain('rate out of range')
		})
	})
})
