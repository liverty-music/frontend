import { I18N } from '@aurelia/i18n'
import { ScannerStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../shared/config/app-config'
import { eventStart, isPublished, paths } from '../../model/concert-model'
import { IScannerClient, type Scanner } from '../../services/scanner-client'
import type { ConfirmDialog } from '../../ui/confirm-dialog/confirm-dialog'
import { ISnackbar } from '../../ui/console-snackbar/snackbar'
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
 * confirming that the device using it stops working.
 */
export class ReceptionTab {
	public readonly page = resolve(IEventPage)
	private readonly scanners = resolve(IScannerClient)
	private readonly snackbar = resolve(ISnackbar)
	private readonly i18n = resolve(I18N)
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
		return paths.editConcert(this.page.seriesId)
	}

	public get confirmTitle(): string {
		if (!this.confirming) return ''
		return this.i18n.tr(
			this.confirming.reissue
				? 'reception.reissueConfirmTitle'
				: 'reception.revokeConfirmTitle',
			{ label: this.label(this.confirming.row) },
		)
	}

	public get confirmBody(): string {
		if (!this.confirming) return ''
		return this.i18n.tr('reception.confirmBody', {
			label: this.label(this.confirming.row),
		})
	}

	public get confirmLabel(): string {
		return this.i18n.tr(
			this.confirming?.reissue
				? 'reception.revokeAndReissue'
				: 'reception.revoke',
		)
	}

	public label(row: ScannerRow): string {
		return this.i18n.tr('reception.label', { number: row.number })
	}

	public async load(): Promise<void> {
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
			this.snackbar.show(
				this.i18n.tr('reception.issued', {
					label: this.i18n.tr('reception.label', {
						number: scanner.number?.value ?? 0,
					}),
				}),
			)
		} catch (err) {
			this.logger.warn('Scanner not issued', err)
			this.snackbar.showError(this.i18n.tr('reception.issueFailed'), {
				label: this.i18n.tr('common.retry'),
				callback: () => void this.issue(),
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
			let message = this.i18n.tr('reception.revoked', {
				label: this.label(row),
			})
			if (reissue) {
				const scanner = await this.scanners.create(this.page.eventId)
				this.upsert(scanner, true)
				message = this.i18n.tr('reception.reissued', {
					label: this.label(row),
					next: this.i18n.tr('reception.label', {
						number: scanner.number?.value ?? 0,
					}),
				})
			}
			this.snackbar.show(message)
		} catch (err) {
			this.logger.warn('Scanner not revoked', err)
			this.snackbar.showError(this.i18n.tr('reception.revokeFailed'))
			await this.load()
		}
	}

	public async share(row: ScannerRow): Promise<void> {
		if (!row.url || !this.canShare) return
		try {
			await navigator.share({
				title: this.i18n.tr('reception.shareTitle', { label: this.label(row) }),
				url: row.url,
			})
		} catch (err) {
			// The operator closed the share sheet.
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
