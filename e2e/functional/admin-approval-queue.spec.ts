import { installAdmin } from '../support/admin'
import type { RpcLog } from '../support/organizer'
import { expect, type Page, test } from '../support/test'

/**
 * The approval queue in the real admin console: a reviewer gives the area
 * and time zone a discovered concert lacks, or replaces a wrong area, and
 * approves. The row states are checked against the rendered route in
 * `test/admin/approval-queue/approval-queue-route.spec.ts`.
 */

const candidate = (id: string, title: string, adminArea?: string) => ({
	id: { value: id },
	performer: { id: { value: 'a-1' }, name: { value: 'Band A' } },
	title: { value: title },
	localDate: { value: { year: 2027, month: 3, day: 14 } },
	listedVenueName: { value: 'Hollywood Bowl' },
	...(adminArea ? { adminArea: { value: adminArea } } : {}),
	resolvedPlaceId: { value: `ChIJ-${id}` },
	findTime: '2026-11-20T09:00:00Z',
})

const area = (code: string, nameEn: string, zone?: string) => ({
	code: { value: code },
	kind: 'AREA_KIND_SUBDIVISION',
	countryCode: { value: code.slice(0, 2) },
	nameEn,
	...(zone ? { timeZone: { value: zone } } : {}),
})

const AREAS: Record<string, ReturnType<typeof area>> = {
	California: area('US-CA', 'California'),
	東京都: area('JP-13', 'Tokyo', 'Asia/Tokyo'),
}

const COUNTRIES: Record<string, Record<string, unknown>> = {
	US: {
		areas: [area('US-CA', 'California'), area('US-TX', 'Texas')],
		timeZones: [
			{
				timeZone: { value: 'America/Chicago' },
				nameEn: 'Chicago',
				nameJa: 'シカゴ',
			},
			{
				timeZone: { value: 'America/Los_Angeles' },
				nameEn: 'Los Angeles',
				nameJa: 'ロサンゼルス',
			},
		],
	},
	JP: {
		areas: [area('JP-13', 'Tokyo', 'Asia/Tokyo')],
		timeZones: [
			{ timeZone: { value: 'Asia/Tokyo' }, nameEn: 'Japan', nameJa: '日本' },
		],
	},
}

async function openQueue(page: Page): Promise<RpcLog> {
	const log = await installAdmin(page, {
		'ConcertCandidateService/List': {
			concertCandidates: [
				candidate('c-la', 'LA Night'),
				candidate('c-jp', 'Tokyo Night', 'JP-99'),
			],
		},
		'ConcertCandidateService/Approve': {},
		'AreaService/Resolve': (req) => {
			const found = AREAS[(req.area as { value: string }).value]
			return found
				? { body: { area: found } }
				: { status: 404, body: { code: 'not_found', message: 'no area' } }
		},
		'AreaService/ListByCountry': (req) => ({
			body: COUNTRIES[(req.countryCode as { value: string }).value] ?? {},
		}),
	})
	await page.goto('/approval-queue')
	return log
}

const rowOf = (page: Page, title: string) =>
	page.locator('details', { hasText: title }).locator('tbody tr')

test('a reviewer gives the missing area and zone, and corrects a wrong area', async ({
	page,
}) => {
	const log = await openQueue(page)
	const approvals = () =>
		log.calls.filter((c) => c.method === 'ConcertCandidateService/Approve')

	// A row without an area: enter California, choose Los Angeles, approve.
	await page.locator('summary', { hasText: 'LA Night' }).click()
	const la = rowOf(page, 'LA Night')
	await expect(la).toContainText('地域不明')
	await expect(la).toContainText('タイムゾーン不明')
	await expect(la.getByRole('button', { name: 'Approve' })).toBeDisabled()
	await la.getByLabel('Area').fill('California')
	await la.getByLabel('Area').press('Tab')
	await la.getByLabel('Time zone').selectOption('America/Los_Angeles')
	await la.getByRole('button', { name: 'Approve' }).click()
	await expect.poll(() => approvals().length).toBe(1)
	await expect(page.locator('summary', { hasText: 'LA Night' })).toHaveCount(0)
	expect(approvals()[0].body).toMatchObject({
		concertCandidateId: { value: 'c-la' },
		adminArea: { value: 'California' },
		timeZone: { value: 'America/Los_Angeles' },
	})

	// A row with JP-99: enter 東京都, whose zone is selected, approve.
	await page.locator('summary', { hasText: 'Tokyo Night' }).click()
	const jp = rowOf(page, 'Tokyo Night')
	await expect(jp).toContainText('JP-99')
	await jp.getByLabel('Area').fill('東京都')
	await jp.getByLabel('Area').press('Tab')
	await expect(jp.getByLabel('Time zone')).toHaveValue('Asia/Tokyo')
	await jp.getByRole('button', { name: 'Approve' }).click()
	await expect(page.locator('summary', { hasText: 'Tokyo Night' })).toHaveCount(
		0,
	)
	expect(approvals()[1].body).toMatchObject({
		concertCandidateId: { value: 'c-jp' },
		adminArea: { value: '東京都' },
		timeZone: { value: 'Asia/Tokyo' },
	})
})

test('a reviewer reads the conflict dialog and keeps the existing event', async ({
	page,
}) => {
	const tokyo = {
		...candidate('c-dup', 'Dome Night', 'JP-13'),
		timeZone: { value: 'Asia/Tokyo' },
		listedVenueName: { value: 'Kyocera Dome Osaka' },
	}
	const log = await installAdmin(page, {
		'ConcertCandidateService/List': { concertCandidates: [tokyo] },
		'ConcertCandidateService/Approve': (req) =>
			req.resolution === 'RESOLUTION_KEEP_EXISTING'
				? { body: {} }
				: {
						body: {
							conflict: {
								existing: {
									eventId: { value: '019a0000-0000-7000-8000-0000000000e1' },
									title: { value: 'Dome Night' },
									listedVenueName: { value: '京セラドーム大阪' },
									localDate: { value: { year: 2027, month: 3, day: 14 } },
								},
								concertCandidate: tokyo,
							},
						},
					},
		'AreaService/Resolve': () => ({ body: { area: AREAS['東京都'] } }),
		'AreaService/ListByCountry': (req) => ({
			body: COUNTRIES[(req.countryCode as { value: string }).value] ?? {},
		}),
	})
	await page.goto('/approval-queue')
	const approvals = () =>
		log.calls.filter((c) => c.method === 'ConcertCandidateService/Approve')

	await page.locator('summary', { hasText: 'Dome Night' }).click()
	await rowOf(page, 'Dome Night')
		.getByRole('button', { name: 'Approve' })
		.click()

	const dialog = page.getByRole('dialog', {
		name: 'Duplicate concert detected',
	})
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText(
		"Either choice keeps that one event and lists the candidate's artist as one of its performers",
	)
	await expect(dialog).toContainText('京セラドーム大阪')
	await dialog.getByRole('button', { name: 'Keep existing' }).click()

	await expect(dialog).toBeHidden()
	await expect(page.locator('summary', { hasText: 'Dome Night' })).toHaveCount(
		0,
	)
	expect(
		approvals().map((c) => c.body.resolution ?? 'RESOLUTION_UNSPECIFIED'),
	).toEqual(['RESOLUTION_UNSPECIFIED', 'RESOLUTION_KEEP_EXISTING'])
})
