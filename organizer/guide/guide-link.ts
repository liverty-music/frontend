/**
 * The members' guide (`organizer/guide/guide.html`, served at `/guide.html` on
 * the console's origin by `Dockerfile.organizer`) and the chapter each console
 * screen opens it at (OpenSpec organizer-console-guide, design D3). The ids are
 * fixed: the guide's chapters carry them, and test/organizer/guide.spec.ts
 * checks that each one exists there.
 */
export const GUIDE_CHAPTERS = [
	'home',
	'sign-in',
	'business-and-payout',
	'publish',
	'change-published',
	'sell',
	'sales-and-referral',
	'reception',
] as const

export type GuideChapter = (typeof GUIDE_CHAPTERS)[number]

/** The address of the guide at one chapter. */
export function guideHref(chapter: GuideChapter): string {
	return `/guide.html#${chapter}`
}

/**
 * The chapter of the screen at a console path (the organizer-shell table):
 * Home → ホームの見かた; Concerts, a concert and the concert editor →
 * 公演をつくって公開する; an event's Sales tab and the sale editors →
 * チケットを販売する; its Reception tab → 受付リンクを発行する; Settings →
 * 事業者情報と受取口座. Any other path is Home's.
 */
export function chapterOf(path: string): GuideChapter {
	const parts = path.replace(/^\/+/, '').split(/[?#]/)[0].split('/')
	if (parts[0] !== 'organizers') return 'home'
	const section = parts[2]
	if (section === 'settings') return 'business-and-payout'
	if (section !== 'artists') return 'home'
	// organizers/:o/artists/:a/series/:s/events/:e/<tab>/...
	if (parts[6] !== 'events' || !parts[7]) return 'publish'
	return parts[8] === 'scanners' ? 'reception' : 'sell'
}
