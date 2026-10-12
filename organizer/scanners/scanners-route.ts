import type { Params } from '@aurelia/router'
import { ScannerStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import {
	formatJstDateTime,
	scannerLabel,
} from '../../shared/lib/scanner/jst-format'
import { Code, toOrganizerErrorMessage } from '../services/connect-error-copy'
import { IScannerClient, type Scanner } from '../services/scanner-client'
import { ISeriesClient } from '../services/series-client'
import { admissionWindowOf } from './admission-window'

type LoadPhase = 'loading' | 'ready' | 'not-found' | 'error'

/** Why Scanners cannot be created for this event, if they cannot. */
export type CreateBlock = 'none' | 'draft' | 'no-start-time' | 'cancelled'

/** A Scanner as the screen lists it. */
export interface ScannerRow {
	readonly id: string
	readonly number: number
	readonly label: string
	readonly status: ScannerStatus
	readonly statusLabel: string
	/** Styling hook for the state. */
	readonly statusKey: 'unused' | 'in-use' | 'revoked' | 'unknown'
	/** The URL to hand to staff; only while the Scanner is unused. */
	readonly url: string
	/** `2026-11-20 14:10` for an in-use Scanner: when its link was first opened. */
	readonly boundSince: string
	readonly revokedAt: string
	readonly canRevoke: boolean
}

export type ConfirmAction = 'revoke' | 'reissue'

const STATUS_LABELS: Record<ScannerStatus, string> = {
	[ScannerStatus.UNSPECIFIED]: '—',
	[ScannerStatus.UNUSED]: '未使用',
	[ScannerStatus.IN_USE]: '使用中',
	[ScannerStatus.REVOKED]: '取り消し済み',
}

const STATUS_KEYS: Record<ScannerStatus, ScannerRow['statusKey']> = {
	[ScannerStatus.UNSPECIFIED]: 'unknown',
	[ScannerStatus.UNUSED]: 'unused',
	[ScannerStatus.IN_USE]: 'in-use',
	[ScannerStatus.REVOKED]: 'revoked',
}

/**
 * The scanner screen URL for a link token, on the reception app's origin
 * (`receptionBaseUrl`), separate from the console's. The link token is in the
 * fragment, so it never reaches a web server or its logs.
 */
export function scannerUrl(
	receptionBaseUrl: string,
	linkToken: string,
): string {
	return `${receptionBaseUrl}/#${linkToken}`
}

/**
 * The guide for venue staff: a static page of the reception app, on the
 * reception origin next to the scanner screen.
 */
export function staffGuideUrl(receptionBaseUrl: string): string {
	return `${receptionBaseUrl}/guide.html`
}

function toRow(scanner: Scanner, receptionBaseUrl: string): ScannerRow {
	const number = scanner.number?.value ?? 0
	const linkToken = scanner.linkToken?.value ?? ''
	return {
		id: scanner.id?.value ?? '',
		number,
		label: scannerLabel(number),
		status: scanner.status,
		statusLabel: STATUS_LABELS[scanner.status],
		statusKey: STATUS_KEYS[scanner.status],
		url:
			scanner.status === ScannerStatus.UNUSED && linkToken
				? scannerUrl(receptionBaseUrl, linkToken)
				: '',
		boundSince: scanner.bindTime
			? formatJstDateTime(timestampDate(scanner.bindTime))
			: '',
		revokedAt: scanner.revokeTime
			? formatJstDateTime(timestampDate(scanner.revokeTime))
			: '',
		canRevoke: scanner.status !== ScannerStatus.REVOKED,
	}
}

/**
 * The console screen where an operator prepares admission for one event: one
 * numbered Scanner per scanner device (受付1, 受付2 …), created with one
 * action, its link URL copied or shared to staff, its state followed (未使用 /
 * 使用中 since first opened / 取り消し済み), and revoked or revoked-and-reissued
 * after an in-page confirmation. It shows the event's admission window, and
 * says why Scanners cannot be created for a draft event or an event without a
 * start time.
 */
export class ScannersRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''
	public eventId = ''
	public seriesId = ''
	public concertTitle = ''
	public eventDate = ''
	public createBlock: CreateBlock = 'none'
	public windowOpen = ''
	public windowClose = ''

	public rows: ScannerRow[] = []
	public busy = false
	public actionError = ''
	/** The Scanner whose confirmation is open (empty when none), and what it confirms. */
	public confirmingId = ''
	public confirmAction: ConfirmAction = 'revoke'
	/** The Scanner just created, whose URL is highlighted. */
	public createdId = ''
	public copiedId = ''

	public readonly canShare =
		typeof navigator !== 'undefined' && typeof navigator.share === 'function'

	private abort: AbortController | null = null
	/** Required by the organizer config loader (`requireReceptionBaseUrl`). */
	private readonly receptionBaseUrl = resolve(IAppConfig).receptionBaseUrl ?? ''

	/** The guide to hand to venue staff, opened in a new tab. */
	public readonly guideUrl = staffGuideUrl(this.receptionBaseUrl)

	private readonly concerts = resolve(ISeriesClient)
	private readonly scanners = resolve(IScannerClient)
	private readonly logger = resolve(ILogger).scopeTo('ScannersRoute')

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

	public get canCreate(): boolean {
		return this.phase === 'ready' && this.createBlock === 'none' && !this.busy
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
			// The event's own state: a draft or cancelled date of a published
			// concert cannot have Scanners.
			const state = event.publishState
			const win = admissionWindowOf(event)
			this.windowOpen = win ? formatJstDateTime(win.open) : ''
			this.windowClose = win ? formatJstDateTime(win.close) : ''
			this.createBlock =
				state === PublishState.CANCELLED
					? 'cancelled'
					: state !== PublishState.PUBLISHED
						? 'draft'
						: !event.startTime?.value
							? 'no-start-time'
							: 'none'

			const scanners = await this.scanners.listByEvent(
				this.eventId,
				abort.signal,
			)
			if (abort.signal.aborted) return
			this.rows = scanners
				.map((s) => toRow(s, this.receptionBaseUrl))
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
			this.logger.error('Loading scanners failed', err)
		}
	}

	/** Creates the event's next Scanner with one action. */
	public async create(): Promise<void> {
		if (!this.canCreate) return
		await this.run(async () => {
			const scanner = await this.scanners.create(this.eventId)
			this.upsert(scanner)
			this.createdId = scanner.id?.value ?? ''
		})
	}

	public askConfirm(row: ScannerRow, action: ConfirmAction): void {
		this.actionError = ''
		this.confirmingId = row.id
		this.confirmAction = action
	}

	public dismissConfirm(): void {
		this.confirmingId = ''
	}

	public isConfirming(row: ScannerRow, action: ConfirmAction): boolean {
		return this.confirmingId === row.id && this.confirmAction === action
	}

	/** Revokes the confirmed Scanner; for `reissue`, creates its replacement. */
	public async confirm(): Promise<void> {
		const pending = { id: this.confirmingId, action: this.confirmAction }
		if (!pending.id || this.busy) return
		this.confirmingId = ''
		await this.run(async () => {
			this.upsert(await this.scanners.revoke(pending.id))
			if (pending.action === 'reissue') {
				const scanner = await this.scanners.create(this.eventId)
				this.upsert(scanner)
				this.createdId = scanner.id?.value ?? ''
			}
		})
	}

	public async copy(row: ScannerRow): Promise<void> {
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

	public async share(row: ScannerRow): Promise<void> {
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
			this.logger.error('Scanner action failed', err)
		} finally {
			this.busy = false
		}
	}

	private upsert(scanner: Scanner): void {
		const row = toRow(scanner, this.receptionBaseUrl)
		const i = this.rows.findIndex((r) => r.id === row.id)
		if (i >= 0) this.rows.splice(i, 1, row)
		else {
			this.rows.push(row)
			this.rows.sort((a, b) => a.number - b.number)
		}
	}
}
