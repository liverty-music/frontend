import type { Params } from '@aurelia/router'
import { ReceptionLinkStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/reception_link_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { ILogger, resolve } from 'aurelia'
import { formatJstDateTime, receptionLinkLabel } from '../reception/jst-format'
import { IConcertAuthoringClient } from '../services/concert-authoring-client'
import { Code, toOrganizerErrorMessage } from '../services/connect-error-copy'
import {
	IReceptionLinkClient,
	type ReceptionLink,
} from '../services/reception-link-client'
import { receptionWindowOf } from './reception-window'

type LoadPhase = 'loading' | 'ready' | 'not-found' | 'error'

/** Why links cannot be issued for this event, if they cannot. */
export type IssueBlock = 'none' | 'draft' | 'no-start-time' | 'cancelled'

/** A link as the screen lists it. */
export interface LinkRow {
	readonly id: string
	readonly number: number
	readonly label: string
	readonly status: ReceptionLinkStatus
	readonly statusLabel: string
	/** Styling hook for the state. */
	readonly statusKey: 'unused' | 'in-use' | 'revoked' | 'unknown'
	/** The URL to hand to staff; only while the link is unused. */
	readonly url: string
	/** `2026-11-20 14:10` for an in-use link: when it was first opened. */
	readonly boundSince: string
	readonly revokedAt: string
	readonly canRevoke: boolean
}

export type ConfirmAction = 'revoke' | 'reissue'

const STATUS_LABELS: Record<ReceptionLinkStatus, string> = {
	[ReceptionLinkStatus.UNSPECIFIED]: '—',
	[ReceptionLinkStatus.UNUSED]: '未使用',
	[ReceptionLinkStatus.IN_USE]: '使用中',
	[ReceptionLinkStatus.REVOKED]: '取り消し済み',
}

const STATUS_KEYS: Record<ReceptionLinkStatus, LinkRow['statusKey']> = {
	[ReceptionLinkStatus.UNSPECIFIED]: 'unknown',
	[ReceptionLinkStatus.UNUSED]: 'unused',
	[ReceptionLinkStatus.IN_USE]: 'in-use',
	[ReceptionLinkStatus.REVOKED]: 'revoked',
}

/** The reception screen URL for a link token, on this console's own origin. */
export function receptionUrl(origin: string, token: string): string {
	return `${origin}/reception/${token}`
}

function toRow(link: ReceptionLink, origin: string): LinkRow {
	const number = link.number?.value ?? 0
	const token = link.token?.value ?? ''
	return {
		id: link.id?.value ?? '',
		number,
		label: receptionLinkLabel(number),
		status: link.status,
		statusLabel: STATUS_LABELS[link.status],
		statusKey: STATUS_KEYS[link.status],
		url:
			link.status === ReceptionLinkStatus.UNUSED && token
				? receptionUrl(origin, token)
				: '',
		boundSince: link.bindTime
			? formatJstDateTime(timestampDate(link.bindTime))
			: '',
		revokedAt: link.revokeTime
			? formatJstDateTime(timestampDate(link.revokeTime))
			: '',
		canRevoke: link.status !== ReceptionLinkStatus.REVOKED,
	}
}

/**
 * The console screen where an operator prepares reception for one event: one
 * numbered link per reception device (受付1, 受付2 …), issued with one action,
 * its URL copied or shared to staff, its state followed (未使用 / 使用中 since
 * first opened / 取り消し済み), and revoked or revoked-and-reissued after an
 * in-page confirmation. It shows the event's reception window, and says why
 * links cannot be issued for a draft event or an event without a start time.
 */
export class ReceptionLinksRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''
	public eventId = ''
	public seriesId = ''
	public concertTitle = ''
	public eventDate = ''
	public issueBlock: IssueBlock = 'none'
	public windowOpen = ''
	public windowClose = ''

	public rows: LinkRow[] = []
	public busy = false
	public actionError = ''
	/** The link whose confirmation is open (empty when none), and what it confirms. */
	public confirmingId = ''
	public confirmAction: ConfirmAction = 'revoke'
	/** The link just issued, whose URL is highlighted. */
	public issuedId = ''
	public copiedId = ''

	public readonly canShare =
		typeof navigator !== 'undefined' && typeof navigator.share === 'function'

	private abort: AbortController | null = null
	private readonly origin = window.location.origin

	private readonly concerts = resolve(IConcertAuthoringClient)
	private readonly links = resolve(IReceptionLinkClient)
	private readonly logger = resolve(ILogger).scopeTo('ReceptionLinksRoute')

	public canLoad(params: Params): boolean {
		this.eventId = params.eventId ?? ''
		return true
	}

	public attached(): void {
		void this.load()
	}

	public detaching(): void {
		this.abort?.abort()
	}

	public get canIssue(): boolean {
		return this.phase === 'ready' && this.issueBlock === 'none' && !this.busy
	}

	public async load(): Promise<void> {
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		this.phase = 'loading'
		this.loadError = ''
		try {
			const concerts = await this.concerts.list(abort.signal)
			if (abort.signal.aborted) return
			const concert = concerts.find((c) =>
				c.events.some((e) => e.id?.value === this.eventId),
			)
			const event = concert?.events.find((e) => e.id?.value === this.eventId)
			if (!concert || !event) {
				this.phase = 'not-found'
				return
			}
			this.seriesId = concert.series?.id?.value ?? ''
			this.concertTitle = concert.series?.title?.value ?? ''
			const d = event.localDate?.value
			this.eventDate = d
				? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
				: ''
			const state = concert.series?.publishState ?? PublishState.UNSPECIFIED
			const win = receptionWindowOf(event)
			this.windowOpen = win ? formatJstDateTime(win.open) : ''
			this.windowClose = win ? formatJstDateTime(win.close) : ''
			this.issueBlock =
				state === PublishState.CANCELLED
					? 'cancelled'
					: state !== PublishState.PUBLISHED
						? 'draft'
						: !event.startTime?.value
							? 'no-start-time'
							: 'none'

			const links = await this.links.list(this.eventId, abort.signal)
			if (abort.signal.aborted) return
			this.rows = links
				.map((l) => toRow(l, this.origin))
				.sort((a, b) => a.number - b.number)
			this.phase = 'ready'
		} catch (err) {
			if (abort.signal.aborted) return
			this.loadError = toOrganizerErrorMessage(
				err,
				'受付リンクを読み込めませんでした。',
				{
					[Code.PermissionDenied]: 'この公演の受付リンクは表示できません。',
				},
			)
			this.phase = 'error'
			this.logger.error('Loading reception links failed', err)
		}
	}

	/** Issues the event's next link with one action. */
	public async issue(): Promise<void> {
		if (!this.canIssue) return
		await this.run(async () => {
			const link = await this.links.issue(this.eventId)
			this.upsert(link)
			this.issuedId = link.id?.value ?? ''
		})
	}

	public askConfirm(row: LinkRow, action: ConfirmAction): void {
		this.actionError = ''
		this.confirmingId = row.id
		this.confirmAction = action
	}

	public dismissConfirm(): void {
		this.confirmingId = ''
	}

	public isConfirming(row: LinkRow, action: ConfirmAction): boolean {
		return this.confirmingId === row.id && this.confirmAction === action
	}

	/** Revokes the confirmed link; for `reissue`, issues its replacement. */
	public async confirm(): Promise<void> {
		const pending = { id: this.confirmingId, action: this.confirmAction }
		if (!pending.id || this.busy) return
		this.confirmingId = ''
		await this.run(async () => {
			this.upsert(await this.links.revoke(pending.id))
			if (pending.action === 'reissue') {
				const link = await this.links.issue(this.eventId)
				this.upsert(link)
				this.issuedId = link.id?.value ?? ''
			}
		})
	}

	public async copy(row: LinkRow): Promise<void> {
		if (!row.url) return
		try {
			await navigator.clipboard.writeText(row.url)
			this.copiedId = row.id
		} catch (err) {
			this.actionError =
				'コピーできませんでした。URLを選択してコピーしてください。'
			this.logger.warn('Copy failed', err)
		}
	}

	public async share(row: LinkRow): Promise<void> {
		if (!row.url || !this.canShare) return
		try {
			await navigator.share({
				title: `${row.label} の受付リンク`,
				url: row.url,
			})
		} catch (err) {
			// Dismissing the share sheet rejects too; nothing to report.
			this.logger.debug('Share ended', err)
		}
	}

	private async run(action: () => Promise<void>): Promise<void> {
		this.busy = true
		this.actionError = ''
		try {
			await action()
		} catch (err) {
			this.actionError = toOrganizerErrorMessage(
				err,
				'操作できませんでした。',
				{
					[Code.FailedPrecondition]:
						'この公演では受付リンクを発行できません。公演が公開済みで、開始時刻が設定されているか確認してください。',
					[Code.PermissionDenied]: 'この公演の受付リンクは操作できません。',
				},
			)
			this.logger.error('Reception link action failed', err)
		} finally {
			this.busy = false
		}
	}

	private upsert(link: ReceptionLink): void {
		const row = toRow(link, this.origin)
		const i = this.rows.findIndex((r) => r.id === row.id)
		if (i >= 0) this.rows.splice(i, 1, row)
		else {
			this.rows.push(row)
			this.rows.sort((a, b) => a.number - b.number)
		}
	}
}
