import { describe, expect, it } from 'vitest'
import guide from '../../organizer/guide/guide.html?raw'
import {
	chapterOf,
	GUIDE_CHAPTERS,
	guideHref,
} from '../../organizer/guide/guide-link'
import ja from '../../organizer/locales/ja/translation.json'

/**
 * The members' guide (organizer/guide/guide.html) is a static page that quotes
 * the console's words. These checks fail when a quoted word changes in the
 * Japanese catalog and the guide is not updated with it, and when a chapter the
 * console links to is missing from the guide.
 */

const SPEC = 'components/infrastructure/organizer/web/route/guide'
const SHELL = 'components/infrastructure/organizer/web/global/organizer-shell'

const doc = new DOMParser().parseFromString(guide, 'text/html')
const chapter = (id: string) => doc.getElementById(id)?.textContent ?? ''

/** Every string value of the Japanese catalog. */
function catalogValues(node: unknown): string[] {
	if (typeof node === 'string') return [node]
	if (node && typeof node === 'object') {
		return Object.values(node).flatMap(catalogValues)
	}
	return []
}
const CATALOG = catalogValues(ja)

/** Checks that each word is a console word and that the text quotes it. */
function expectQuoted(text: string, words: string[]): void {
	for (const word of words) {
		expect(
			CATALOG.some((value) => value.includes(word)),
			`${word} is not in the console`,
		).toBe(true)
		expect(text, word).toContain(word)
	}
}

/** The chapters in the guide spec's order, with their headings. */
const CHAPTERS: Array<[string, string]> = [
	['home', 'ホームの見かた'],
	['sign-in', 'サインインする'],
	['business-and-payout', '事業者情報と受取口座'],
	['publish', '公演をつくって公開する'],
	['change-published', '公開した公演を変える'],
	['sell', 'チケットを販売する'],
	['sales-and-referral', '売れ行きと紹介コード'],
	['reception', '受付リンクを発行する'],
]

describe('members guide', () => {
	it(`@spec ${SPEC} "Opened signed out"`, () => {
		expect(guide).toMatch(/^<!doctype html>/i)
		expect(guide).toContain('<html lang="ja">')
		expect(guide).toContain('<meta name="robots" content="noindex">')
		// Nothing runs, so nothing can start a sign-in or read any data.
		expect(guide).not.toMatch(/<script|<iframe|<form|\son\w+="/i)
		expect(guide).not.toMatch(/oidc|zitadel|config\.json|\/organizer\/main/i)
	})

	it(`@spec ${SPEC} "Contents"`, () => {
		const links = [...doc.querySelectorAll('nav.toc a')]
		expect(links.map((a) => [a.getAttribute('href'), a.textContent])).toEqual(
			CHAPTERS.map(([id, heading]) => [`#${id}`, heading]),
		)
		// The list of chapters comes first, before the screen map and chapters.
		const main = doc.querySelector('main')
		expect(main?.querySelector(':scope > nav, :scope > section')).toBe(
			doc.querySelector('nav.toc'),
		)
	})

	it(`@spec ${SPEC} "Link to a chapter"`, () => {
		const sections = [...doc.querySelectorAll('main > section[id]')]
			.map((s) => [s.id, s.querySelector('h2')?.textContent])
			.filter(([id]) => id !== 'map')
		expect(sections).toEqual(CHAPTERS)
		expect(GUIDE_CHAPTERS).toEqual(CHAPTERS.map(([id]) => id))
	})

	it(`@spec ${SPEC} "Where a Home item leads"`, () => {
		const map = doc.getElementById('map')
		expect(map, 'the screen map follows the contents').not.toBeNull()
		for (const destination of ['ホーム', '公演', '設定']) {
			expect(
				[...(map?.querySelectorAll('.dest > h3') ?? [])].map(
					(h) => h.textContent,
				),
			).toContain(destination)
		}
		const leads = [...(map?.querySelectorAll('.leads li') ?? [])].map((li) => [
			li.querySelector('.badge')?.textContent,
			li.querySelector('.to')?.textContent,
		])
		expect(leads).toContainEqual(['7日以内', '公演日の「受付」タブ'])
		expect(leads.map(([kind]) => kind)).toEqual(Object.values(ja.home.kind))
		expectQuoted(map?.textContent ?? '', [
			ja.event.tab.sales,
			ja.event.tab.reception,
			ja.sale.startLottery,
			ja.sale.startFirstCome,
		])
	})

	it(`@spec ${SPEC} "Publishing step"`, () => {
		expectQuoted(chapter('publish'), [
			ja.event.publish,
			ja.concert.cancelConcert,
			ja.concerts.create,
			ja.publishState.draft,
			ja.publishState.published,
			ja.publishState.cancelled,
			ja.visibility.public,
			ja.visibility.unlisted,
		])
		expectQuoted(chapter('change-published'), [
			ja.event.cancel,
			ja.concert.cancelConcert,
			ja.concertEditor.addDate,
		])
	})

	it(`@spec ${SPEC} "Selling step"`, () => {
		const sell = chapter('sell')
		expectQuoted(sell, [
			ja.sale.startLottery,
			ja.sale.startFirstCome,
			...Object.values(ja.sale.lotteryState),
			...Object.values(ja.sale.firstComeState),
			ja.lotteryEditor.create,
			ja.firstComeEditor.create,
			ja.sale.lockedAfterOpen,
			ja.sale.prerequisite.notPublished,
			ja.sale.prerequisite.noStartTime,
			ja.sale.prerequisite.noStock,
			ja.sale.prerequisite.businessDetails,
			ja.seatType.title,
			ja.seatType.add,
			ja.stock.title,
			ja.stock.add,
			...Object.values(ja.stock.state),
			ja.concertEditor.perAccountLimit,
			ja.event.editConcert,
		])
	})

	it(`@spec ${SPEC} "Shared quantities"`, () => {
		const sell = chapter('sell')
		expect(sell).toContain('同じ枚数から')
		expect(sell).toContain('保存すると変えられません')
		expect(sell).toContain('別の席種（例: 注釈付き指定席）')
		expect(sell).toContain('1つの席種だけ')
	})

	it('quotes the other screens as they read', () => {
		expectQuoted(chapter('home'), [
			...Object.values(ja.home.kind),
			...Object.values(ja.home.action),
			ja.home.allClear,
		])
		expectQuoted(chapter('sign-in'), [
			ja.findOrganizer.title,
			ja.findOrganizer.send,
			ja.shell.signOut,
		])
		expectQuoted(chapter('business-and-payout'), [
			ja.settings.payout.start,
			ja.settings.payout.continue,
			ja.settings.payout.pending,
			ja.settings.payout.active,
			ja.settings.payout.restricted,
			ja.settings.business.notRegistered,
			ja.sale.prerequisite.businessDetails,
			ja.home.payout,
		])
		expectQuoted(chapter('sales-and-referral'), [
			ja.sale.referral.title,
			ja.sale.referral.direct,
			ja.sale.referral.empty,
			ja.event.fanPage,
		])
		expectQuoted(chapter('reception'), [
			ja.reception.issue,
			ja.reception.revokeAndReissue,
			ja.reception.guide,
			ja.common.copy,
			ja.reception.share,
			...Object.values(ja.reception.status),
		])
	})

	it(`@spec ${SPEC} "Referral link"`, () => {
		const referral = chapter('sales-and-referral')
		expect(referral).toMatch(
			/https:\/\/liverty-music\.app\/events\/\S+\?ref=member-a/,
		)
		expect(referral).toContain('7日以内')
		expect(referral).toContain('最後に開いたコード')
	})

	it(`@spec ${SPEC} "Sale blocked by business details"`, () => {
		const business = chapter('business-and-payout')
		expect(business).toContain('Liverty Music が登録します')
		expect(business).toContain(
			'5つすべてが登録されるまで、販売は始められません。',
		)
	})
})

describe('guide links', () => {
	const event = '/organizers/o/artists/a/series/s/events/e'

	it('every chapter the console links to is in the guide', () => {
		for (const id of GUIDE_CHAPTERS) {
			expect(doc.getElementById(id), id).not.toBeNull()
			expect(guideHref(id)).toBe(`/guide.html#${id}`)
		}
	})

	it(`maps every screen of the ${SHELL} table to its chapter`, () => {
		expect.soft(chapterOf('/organizers/o')).toBe('home')
		expect.soft(chapterOf('/organizers/o/artists')).toBe('publish')
		expect.soft(chapterOf('/organizers/o/artists/a/series')).toBe('publish')
		expect.soft(chapterOf('/organizers/o/artists/a/series/new')).toBe('publish')
		expect.soft(chapterOf('/organizers/o/artists/a/series/s')).toBe('publish')
		expect
			.soft(chapterOf('/organizers/o/artists/a/series/s/edit'))
			.toBe('publish')
		expect.soft(chapterOf(event)).toBe('sell')
		expect.soft(chapterOf(`${event}/ticket-sales`)).toBe('sell')
		expect
			.soft(chapterOf(`${event}/ticket-sales/new?method=lottery`))
			.toBe('sell')
		expect.soft(chapterOf(`${event}/ticket-sales/t-1/edit`)).toBe('sell')
		expect.soft(chapterOf(`${event}/scanners`)).toBe('reception')
		expect.soft(chapterOf('/organizers/o/settings')).toBe('business-and-payout')
		expect.soft(chapterOf('/')).toBe('home')
	})
})
