import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import {
	type Organizer,
	OrganizerSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IArtistClient } from '../../../organizer/services/artist-client'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import {
	IPayoutAccountClient,
	PayoutOnboardingStatus,
} from '../../../organizer/services/payout-account-client'
import { SettingsRoute } from '../../../organizer/settings/settings-route'
import { ConsoleButton } from '../../../organizer/ui/console-button/console-button'
import { ConsoleIcon } from '../../../organizer/ui/console-icon/console-icon'
import { DescriptionList } from '../../../organizer/ui/description-list/description-list'
import { PrerequisiteCallout } from '../../../organizer/ui/prerequisite-callout/prerequisite-callout'
import { StatusBadge } from '../../../organizer/ui/status-badge/status-badge'

const SPEC = 'components/infrastructure/organizer/web/route/settings'

const ONBOARDING_URL = 'https://connect.stripe.example/setup/s/acct_1/abc'

/** The business details of a complete Organizer. */
const DETAILS = {
	legalName: { value: '株式会社エックス' },
	representativeName: { value: '山田 太郎' },
	businessAddress: { value: '東京都渋谷区神南1-1-1' },
	businessPhoneNumber: { value: '03-0000-0000' },
	contactEmail: { value: 'info@example.com' },
}

function organizer(missing: Array<keyof typeof DETAILS> = []): Organizer {
	const details: Partial<typeof DETAILS> = { ...DETAILS }
	for (const key of missing) delete details[key]
	return create(OrganizerSchema, {
		id: { value: 'org-1' },
		name: { value: 'XX Records' },
		...details,
	})
}

interface Setup {
	organizer?: Organizer
	/** The payout account status; `null` for an Organizer with no account yet. */
	payout?: PayoutOnboardingStatus | null
	startOnboarding?: ReturnType<typeof vi.fn>
}

/** The text of a node, reading through the shadow roots of console components. */
function textOf(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
	const el = node as Element
	// A slot shows what was assigned to it, as the member reads it.
	if (el instanceof HTMLSlotElement) {
		return el
			.assignedNodes({ flatten: true })
			.map((assigned) => textOf(assigned))
			.join('')
	}
	const children = el.shadowRoot?.childNodes ?? el.childNodes
	return [...children].map((child) => textOf(child)).join('')
}

/** The text of a node as a member reads it, whitespace collapsed. */
const read = (node: Node) => textOf(node).replace(/\s+/g, ' ').trim()

async function mount(setup: Setup = {}) {
	const payout =
		setup.payout === undefined ? PayoutOnboardingStatus.ACTIVE : setup.payout
	const clients = {
		organizer: {
			get: vi.fn().mockResolvedValue(setup.organizer ?? organizer()),
		},
		artists: {
			list: vi.fn().mockResolvedValue([
				create(ArtistSchema, {
					id: { value: 'a-1' },
					name: { value: 'Band A' },
				}),
				create(ArtistSchema, {
					id: { value: 'a-2' },
					name: { value: 'Band B' },
				}),
			]),
		},
		payout: {
			get: vi
				.fn()
				.mockResolvedValue(payout === null ? null : { status: payout }),
			startOnboarding:
				setup.startOnboarding ?? vi.fn().mockResolvedValue(ONBOARDING_URL),
		},
	}
	const fixture = createFixture('<settings-route></settings-route>', class {}, [
		ConsoleI18nConfiguration,
		...ConsoleFormatters,
		ConsoleButton,
		ConsoleIcon,
		DescriptionList,
		PrerequisiteCallout,
		StatusBadge,
		SettingsRoute,
		Registration.instance(IOrganizerClient, clients.organizer),
		Registration.instance(IArtistClient, clients.artists),
		Registration.instance(IPayoutAccountClient, clients.payout),
	])
	await fixture.startPromise
	await tasksSettled()
	const host = fixture.appHost.querySelector('settings-route') as HTMLElement
	/** The section headed `heading`. */
	const part = (heading: string): HTMLElement => {
		const h2 = [...host.querySelectorAll('h2')].find(
			(h) => h.textContent?.trim() === heading,
		)
		const section = h2?.closest('section')
		if (!section) throw new Error(`no section headed ${heading}`)
		return section
	}
	/** The value shown for a business detail term. */
	const detail = (term: string): string => {
		const dt = [
			...(part('事業者情報')
				.querySelector('description-list')
				?.shadowRoot?.querySelectorAll('dt') ?? []),
		].find((d) => d.textContent?.includes(term))
		return dt?.nextElementSibling?.textContent?.trim() ?? ''
	}
	/** The onboarding action of the payout section, or null when it is absent. */
	const action = (): HTMLButtonElement | null =>
		part('入金口座')
			.querySelector('console-button')
			?.shadowRoot?.querySelector('button') ?? null
	/** The label of the onboarding action, with its hidden note. */
	const label = (): string =>
		read(part('入金口座').querySelector('console-button') as Element)
	const done = async () => {
		await tasksSettled()
		await fixture.tearDown()
	}
	return { host, part, detail, action, label, clients, done }
}

const HAND_OFF = [
	'ファンはチケットを購入できます',
	'Liverty Music の決済代行会社 Stripe',
	'事業者の情報、代表者の本人確認、入金先の銀行口座',
	'Stripe からコンソールのホームに戻ります',
]

describe('settings route', () => {
	const assign = vi.fn()
	beforeEach(() => {
		localStorage.clear()
		assign.mockReset()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
		vi.stubGlobal('location', { ...window.location, assign, hash: '' })
	})
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it(`@spec ${SPEC} "Two represented Artists"`, async () => {
		const { host, part, done } = await mount()

		expect(
			[...host.querySelectorAll('h2')].map((h) => h.textContent?.trim()),
		).toEqual(['組織', 'アーティスト', '事業者情報', '入金口座'])
		expect(read(part('組織'))).toContain('XX Records')
		expect(read(part('組織'))).toContain('Liverty Music が承ります')
		expect(
			[...part('アーティスト').querySelectorAll('li')].map((li) =>
				li.textContent?.trim(),
			),
		).toEqual(['Band A', 'Band B'])
		// Read only: nothing to edit.
		expect(host.querySelectorAll('input, textarea, select')).toHaveLength(0)
		await done()
	})

	it(`@spec ${SPEC} "Complete details"`, async () => {
		const { part, detail, done } = await mount()

		expect(detail('事業者名')).toBe('株式会社エックス')
		expect(detail('代表者名')).toBe('山田 太郎')
		expect(detail('所在地')).toBe('東京都渋谷区神南1-1-1')
		expect(detail('電話番号')).toBe('03-0000-0000')
		expect(detail('連絡先メールアドレス')).toBe('info@example.com')
		const business = read(part('事業者情報'))
		expect(business).toContain('特定商取引法に基づく表記')
		expect(business).not.toContain('未登録')
		expect(business).not.toContain('販売は始められません')
		await done()
	})

	it(`@spec ${SPEC} "Address missing"`, async () => {
		const { part, detail, done } = await mount({
			organizer: organizer(['businessAddress']),
		})

		expect(detail('所在地')).toBe('未登録')
		expect(detail('事業者名')).toBe('株式会社エックス')
		expect(read(part('事業者情報'))).toContain(
			'すべての事業者情報が登録されるまで、販売は始められません。',
		)
		await done()
	})

	it(`@spec ${SPEC} "No payout account yet"`, async () => {
		const { part, label, done } = await mount({ payout: null })

		const payout = part('入金口座')
		for (const text of HAND_OFF) expect(read(payout)).toContain(text)
		expect(label()).toMatch(/^Stripe で登録する\s*（外部サイトに移動します）$/)
		expect(payout.querySelector('[data-testid="payout-status"]')).toBeNull()
		expect(read(payout)).not.toContain('状態')
		expect(read(payout)).not.toContain('読み込めませんでした')
		await done()
	})

	it(`@spec ${SPEC} "Onboarding not finished"`, async () => {
		const { part, action, label, done } = await mount({
			payout: PayoutOnboardingStatus.PENDING,
		})

		const payout = part('入金口座')
		expect(
			read(payout.querySelector('[data-testid="payout-status"]') as Element),
		).toBe('確認中')
		for (const text of HAND_OFF) expect(read(payout)).toContain(text)
		expect(label()).toMatch(
			/^Stripe で登録を続ける\s*（外部サイトに移動します）$/,
		)
		expect(action()?.getAttribute('data-variant')).toBe('outlined')
		// The explanation comes before the action.
		const text = read(payout)
		expect(
			text.indexOf('Stripe からコンソールのホームに戻ります'),
		).toBeLessThan(text.indexOf('Stripe で登録を続ける'))
		await done()
	})

	it(`@spec ${SPEC} "Member goes to Stripe"`, async () => {
		let answer: () => void = () => {}
		const answered = new Promise<void>((resolve) => {
			answer = resolve
		})
		const startOnboarding = vi.fn(async () => {
			await answered
			return ONBOARDING_URL
		})
		const { action, done } = await mount({
			payout: PayoutOnboardingStatus.PENDING,
			startOnboarding,
		})

		action()?.click()
		await tasksSettled()

		// Unavailable while the onboarding page is prepared.
		expect(action()?.getAttribute('aria-disabled')).toBe('true')
		action()?.click()
		answer()
		await tasksSettled()

		// Stripe's page opens in this tab, once.
		expect(startOnboarding).toHaveBeenCalledTimes(1)
		expect(assign).toHaveBeenCalledTimes(1)
		expect(assign).toHaveBeenCalledWith(ONBOARDING_URL)
		await done()
	})

	it(`@spec ${SPEC} "Stripe's page cannot be prepared"`, async () => {
		const startOnboarding = vi
			.fn()
			.mockRejectedValue(
				new ConnectError('stripe: connection refused', Code.Unavailable),
			)
		const { host, part, action, done } = await mount({
			payout: PayoutOnboardingStatus.PENDING,
			startOnboarding,
		})

		action()?.click()
		await tasksSettled()

		expect(
			part('入金口座').querySelector('[role="alert"]')?.textContent?.trim(),
		).toBe('Stripe のページを開けませんでした。もう一度お試しください。')
		expect(read(host)).not.toContain('connection refused')
		expect(assign).not.toHaveBeenCalled()

		// The action is available again.
		await vi.waitFor(() =>
			expect(action()?.getAttribute('aria-disabled')).toBeNull(),
		)
		action()?.click()
		await tasksSettled()
		expect(startOnboarding).toHaveBeenCalledTimes(2)
		await done()
	})

	it(`@spec ${SPEC} "Active account"`, async () => {
		const { part, done } = await mount()

		const payout = part('入金口座')
		expect(
			read(payout.querySelector('[data-testid="payout-status"]') as Element),
		).toBe('有効')
		expect(payout.querySelectorAll('console-button')).toHaveLength(0)
		expect(read(payout)).not.toContain('ファンはチケットを購入できます')
		expect(read(payout)).not.toContain('Stripe')
		await done()
	})
})
