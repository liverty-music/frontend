import { ScannerStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../shared/config/app-config'
import { IConsoleLanguage } from '../../i18n/console-language'
import { eventStart, isPublished, paths } from '../../model/concert-model'
import { IScannerClient, type Scanner } from '../../services/scanner-client'
import { IConsoleContext } from '../../shell/console-context'
import { IPageProgress } from '../../shell/page-progress'
import type { ConfirmDialog } from '../../ui/confirm-dialog/confirm-dialog'
import { ISnackbar } from '../../ui/console-snackbar/snackbar'
import type { MenuItem } from '../../ui/overflow-menu/overflow-menu'
import type { StatusTone } from '../../ui/status-badge/status-badge'
import { IEventPage } from '../event-page'
import { admissionWindowOf } from './admission-window'

export type ReceptionPrerequisite = 'notPublished' | 'noStartTime'

/** One Scanner as the Reception tab lists it. */
export interface ScannerRow {
	id: string
	number: number
	status: ScannerStatus
	tone: StatusTone
	statusKey: string
	/** The link, shown only while the Scanner is Unused. */
	url: string
	boundSince?: Date
	canRevoke: boolean
	/** Set on the row just issued, for its entering motion. */
	isNew: boolean
}

/** The Scanner link: on the reception origin, the token in the fragment. */
export function scannerUrl(
	receptionBaseUrl: string,
	linkToken: string,
): string {
	return `${receptionBaseUrl}/#${linkToken}`
}

export function staffGuideUrl(receptionBaseUrl: string): string {
	return `${receptionBaseUrl}/guide.html`
}

const STATUS: Record<number, { tone: StatusTone; key: string }> = {
	[ScannerStatus.UNUSED]: { tone: 'success', key: 'reception.status.unused' },
	[ScannerStatus.IN_USE]: { tone: 'info', key: 'reception.status.inUse' },
	[ScannerStatus.REVOKED]: { tone: 'neutral', key: 'reception.status.revoked' },
}

export function scannerRow(
	scanner: Scanner,
	receptionBaseUrl: string,
	isNew = false,
): ScannerRow {
	const token = scanner.linkToken?.value ?? ''
	const status = STATUS[scanner.status] ?? STATUS[ScannerStatus.REVOKED]
	return {
		id: scanner.id?.value ?? '',
		number: scanner.number?.value ?? 0,
		status: scanner.status,
		tone: status.tone,
		statusKey: status.key,
		url:
			scanner.status === ScannerStatus.UNUSED && token
				? scannerUrl(receptionBaseUrl, token)
				: '',
		boundSince: scanner.bindTime ? timestampDate(scanner.bindTime) : undefined,
		canRevoke: scanner.status !== ScannerStatus.REVOKED,
		isNew,
	}
}

/**
 * The event's Reception (受付) tab: one Scanner per device, issued with one
 * action and handed to staff by its link; revoke, or revoke and reissue, after
 * confirming that the device using it stops working. The Scanners are an M3
 * multi-action list (design D18): each item's name, state and link as its
 * content, with the copy button and an overflow menu (共有, 取り消す,
 * 取り消して再発行) at its trailing edge.
 */
export class ReceptionTab {
	public readonly page = resolve(IEventPage)
	private readonly scanners = resolve(IScannerClient)
	private readonly snackbar = resolve(ISnackbar)
	private readonly language = resolve(IConsoleLanguage)
	private readonly context = resolve(IConsoleContext)
	private readonly progress = resolve(IPageProgress)
	private readonly logger = resolve(ILogger).scopeTo('ReceptionTab')
	private readonly receptionBaseUrl = resolve(IAppConfig).receptionBaseUrl ?? ''

	public readonly guideUrl = staffGuideUrl(this.receptionBaseUrl)
	public readonly canShare =
		typeof navigator !== 'undefined' && typeof navigator.share === 'function'

	public state: 'loading' | 'ready' | 'error' = 'loading'
	public rows: ScannerRow[] = []
	public issuing = false
	public confirmDialog!: ConfirmDialog
	public confirming: { row: ScannerRow; reissue: boolean } | null = null
	private abort = new AbortController()

	public async loading(): Promise<void> {
		await this.page.ready
	}

	public attached(): void {
		if (!this.prerequisite) void this.load()
		else this.state = 'ready'
	}

	public detaching(): void {
		this.abort.abort()
	}

	public get prerequisite(): ReceptionPrerequisite | null {
		const event = this.page.event
		if (!event || !isPublished(event)) return 'notPublished'
		if (!eventStart(event)) return 'noStartTime'
		return null
	}

	public get admission(): { open: Date; close: Date } | null {
		return this.page.event ? admissionWindowOf(this.page.event) : null
	}

	public get editConcertHref(): string {
		return paths.editConcert(this.context.scope, this.page.seriesId)
	}

	/** Catalog key of the confirmation's title; its value is `confirmNumber`. */
	public get confirmTitleKey(): string {
		return this.confirming?.reissue
			? 'reception.reissueConfirmTitle'
			: 'reception.revokeConfirmTitle'
	}

	public get confirmKey(): string {
		return this.confirming?.reissue
			? 'reception.revokeAndReissue'
			: 'reception.revoke'
	}

	/** The number of the Scanner being revoked (受付1). */
	public get confirmNumber(): number {
		return this.confirming?.row.number ?? 0
	}

	/** The further actions of a Scanner that is not revoked. */
	public menuOf(row: ScannerRow): MenuItem[] {
		const items: MenuItem[] = []
		if (row.url && this.canShare) {
			items.push({ id: 'share', labelKey: 'reception.share' })
		}
		items.push(
			{ id: 'revoke', labelKey: 'reception.revoke' },
			{ id: 'reissue', labelKey: 'reception.revokeAndReissue' },
		)
		return items
	}

	public onMenu(row: ScannerRow, id: string): void {
		if (id === 'share') void this.share(row)
		else if (id === 'revoke') void this.revoke(row, false)
		else if (id === 'reissue') void this.revoke(row, true)
	}

	public load(): Promise<void> {
		return this.progress.track(this.read())
	}

	private async read(): Promise<void> {
		this.state = 'loading'
		try {
			const scanners = await this.scanners.listByEvent(
				this.page.eventId,
				this.abort.signal,
			)
			this.rows = scanners
				.map((s) => scannerRow(s, this.receptionBaseUrl))
				.sort((a, b) => a.number - b.number)
			this.state = 'ready'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Scanners unavailable', err)
			this.state = 'error'
		}
	}

	public requestPublish(): void {
		void this.page.requestPublish()
	}

	public async issue(): Promise<void> {
		if (this.prerequisite || this.issuing) return
		this.issuing = true
		try {
			const scanner = await this.scanners.create(this.page.eventId)
			this.upsert(scanner, true)
			this.snackbar.show('reception.issued', {
				number: scanner.number?.value ?? 0,
			})
		} catch (err) {
			this.logger.warn('Scanner not issued', err)
			this.snackbar.showError('reception.issueFailed', {
				retry: () => void this.issue(),
			})
		} finally {
			this.issuing = false
		}
	}

	public async revoke(row: ScannerRow, reissue: boolean): Promise<void> {
		this.confirming = { row, reissue }
		if (!(await this.confirmDialog.ask())) return
		try {
			this.upsert(await this.scanners.revoke(row.id))
			if (!reissue) {
				this.snackbar.show('reception.revoked', { number: row.number })
				return
			}
			const scanner = await this.scanners.create(this.page.eventId)
			this.upsert(scanner, true)
			this.snackbar.show('reception.reissued', {
				number: row.number,
				next: scanner.number?.value ?? 0,
			})
		} catch (err) {
			this.logger.warn('Scanner not revoked', err)
			this.snackbar.showError('reception.revokeFailed')
			await this.load()
		}
	}

	public async share(row: ScannerRow): Promise<void> {
		if (!row.url || !this.canShare) return
		try {
			await navigator.share({
				// The share sheet is outside the page: its title is passed as text.
				title: this.language.text('reception.shareTitle', {
					number: row.number,
				}),
				url: row.url,
			})
		} catch (err) {
			// The member closed the share sheet.
			this.logger.debug('Share ended', err)
		}
	}

	private upsert(scanner: Scanner | undefined, isNew = false): void {
		if (!scanner) return
		const row = scannerRow(scanner, this.receptionBaseUrl, isNew)
		const i = this.rows.findIndex((r) => r.id === row.id)
		if (i >= 0) this.rows.splice(i, 1, row)
		else {
			this.rows.push(row)
			this.rows.sort((a, b) => a.number - b.number)
		}
	}
}
