import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import type { TicketEmail } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_email_pb.js'
import { ILogger, resolve } from 'aurelia'
import type { FollowedArtist } from '../../entities/follow'
import { IConcertService } from '../../services/concert-service'
import { IFollowServiceClient } from '../../services/follow-service-client'
import {
	type EmailType,
	ITicketEmailService,
} from '../../services/ticket-email-service'

// Regex for detecting ticket-related Japanese email content.
const TICKET_EMAIL_REGEX =
	/抽選|当選|落選|チケット|入金期限|支払期限|先行|受付|e\+|ぴあ|ローチケ|ticket|lottery/i

type WizardStep =
	| 'validation'
	| 'artist'
	| 'concert'
	| 'body'
	| 'parsing'
	| 'confirm'
	| 'done'

export class ImportTicketEmailRoute {
	// Wizard state
	public step: WizardStep = 'validation'
	public error = ''
	public isLoading = false

	// Shared data from Gmail
	public emailTitle = ''
	public emailBody = ''

	// Step 2-3: Artist selection
	public followedArtists: FollowedArtist[] = []
	public matchedArtistId = ''
	public selectedArtistId = ''

	// Step 4: Concert selection
	public concerts: Concert[] = []
	public selectedEventIds: Set<string> = new Set()

	// Step 5: Editable body
	public editableBody = ''
	public isEditingBody = false

	// Step 6: Email type detection
	public detectedEmailType: EmailType = 'lottery_info'

	// Step 7: Parse results
	public createdEmails: TicketEmail[] = []

	private readonly logger = resolve(ILogger).scopeTo('ImportTicketEmail')
	private readonly followService = resolve(IFollowServiceClient)
	private readonly concertService = resolve(IConcertService)
	private readonly ticketEmailService = resolve(ITicketEmailService)
	private abortController: AbortController | null = null

	public async loading(): Promise<void> {
		this.abortController = new AbortController()

		// Extract shared data from URL query params (set by SW redirect).
		const urlParams = new URLSearchParams(window.location.search)
		this.emailTitle = urlParams.get('title') ?? ''
		this.emailBody = urlParams.get('text') ?? ''
		this.editableBody = this.emailBody

		// Detect email type from content.
		this.detectedEmailType = this.detectEmailType(this.emailBody)

		// Step 1: Validate.
		if (!TICKET_EMAIL_REGEX.test(this.emailBody)) {
			this.error = 'このメールはチケット情報として認識できませんでした。'
			this.step = 'validation'
			return
		}

		// Load followed artists for matching.
		try {
			this.followedArtists = await this.followService.listFollowed(
				this.abortController.signal,
			)
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('Failed to load followed artists', { error: err })
			}
		}

		// Step 2: Auto-match artist name in email body.
		for (const fa of this.followedArtists) {
			const name = fa.artist.name?.value ?? ''
			const id = fa.artist.id?.value ?? ''
			if (name && this.emailBody.includes(name)) {
				this.matchedArtistId = id
				this.selectedArtistId = id
				break
			}
		}

		this.step = 'artist'
	}

	public detaching(): void {
		this.abortController?.abort()
	}

	// Step 3: Artist selected → load concerts.
	public async selectArtist(): Promise<void> {
		if (!this.selectedArtistId) return
		this.isLoading = true
		try {
			this.concerts = await this.concertService.listConcerts(
				this.selectedArtistId,
				this.abortController?.signal,
			)
			this.step = 'concert'
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('Failed to load concerts', { error: err })
				this.error = 'コンサートの読み込みに失敗しました。'
			}
		} finally {
			this.isLoading = false
		}
	}

	// Step 4: Toggle concert selection.
	public toggleConcert(eventId: string): void {
		if (this.selectedEventIds.has(eventId)) {
			this.selectedEventIds.delete(eventId)
		} else {
			this.selectedEventIds.add(eventId)
		}
	}

	public get hasSelectedConcerts(): boolean {
		return this.selectedEventIds.size > 0
	}

	// Step 4 → 5: Proceed to body confirmation.
	public confirmConcerts(): void {
		this.step = 'body'
	}

	// Step 5: Toggle body editing.
	public toggleEditBody(): void {
		this.isEditingBody = !this.isEditingBody
	}

	// Step 5 → 6: Submit to backend for parsing.
	public async submitForParsing(): Promise<void> {
		this.step = 'parsing'
		this.isLoading = true
		this.error = ''

		try {
			this.createdEmails = await this.ticketEmailService.create(
				this.editableBody,
				this.detectedEmailType,
				Array.from(this.selectedEventIds),
				this.abortController?.signal,
			)
			this.step = 'confirm'
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('Failed to parse email', { error: err })
				this.error = 'メールの解析に失敗しました。もう一度お試しください。'
				this.step = 'body'
			}
		} finally {
			this.isLoading = false
		}
	}

	// Step 7: Confirm parsed results.
	public async confirmResults(): Promise<void> {
		this.isLoading = true
		this.error = ''

		try {
			for (const email of this.createdEmails) {
				if (email.id) {
					await this.ticketEmailService.update(
						email.id.value,
						{},
						this.abortController?.signal,
					)
				}
			}
			this.step = 'done'
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('Failed to confirm email', { error: err })
				this.error = '確認に失敗しました。もう一度お試しください。'
			}
		} finally {
			this.isLoading = false
		}
	}

	private detectEmailType(body: string): EmailType {
		if (/当選|落選|抽選結果/.test(body)) {
			return 'lottery_result'
		}
		return 'lottery_info'
	}
}
