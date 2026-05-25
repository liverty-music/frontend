import type { Params, RouteNode } from '@aurelia/router'
import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import type { TicketEmail } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_email_pb.js'
import { TicketJourneyStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_journey_pb.js'
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
	public selectedEventIds: string[] = []

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

	public async loading(_params: Params, next: RouteNode): Promise<void> {
		this.abortController = new AbortController()

		// Extract shared data from URL query params (set by SW redirect).
		const urlParams = next.queryParams
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
			const name = fa.artist.name ?? ''
			const id = fa.artist.id ?? ''
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

	// Mirrors the `if.bind="concert.id?.value"` filter on the
	// <li repeat.for> list: returns true only when at least one concert
	// will actually render. Used by the empty-state <p>'s guard so the
	// "no concerts found" message still shows when every returned proto
	// has a blank id (schema-skew rollout window) — otherwise the user
	// would see a completely blank list with no explanation because
	// concerts.length > 0 but every row is hidden.
	public get hasDisplayableConcerts(): boolean {
		return this.concerts.some((c) => Boolean(c.id?.value))
	}

	public get hasSelectedConcerts(): boolean {
		return this.selectedEventIds.length > 0
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
				this.selectedEventIds,
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

	// formatLocalDate renders a proto LocalDate.value (a `{year, month, day}`
	// google.type.Date message) as a zero-padded YYYY-MM-DD string for display.
	// Without this helper the template `${concert.localDate?.value}` would
	// stringify the proto message via its default toString() and render
	// `[object Object]`, which is what every concert row was showing in the
	// step-4 selection list before this method existed.
	public formatLocalDate(
		d: { year: number; month: number; day: number } | undefined,
	): string {
		if (!d) return ''
		// Treat any zero component as "unpopulated". Proto3 leaves missing
		// scalar fields at their type-zero defaults independently, so a
		// partially-serialised Date like {year:2025, month:0, day:0} (backend
		// only set the year) would render as '2025-00-00' in the row's
		// <small> slot. Symmetric for the year:0 case. Returning '' keeps
		// the slot blank for any partially-populated Date.
		if (d.year === 0 || d.month === 0 || d.day === 0) return ''
		const month = String(d.month).padStart(2, '0')
		const day = String(d.day).padStart(2, '0')
		return `${d.year}-${month}-${day}`
	}

	public sanitizeUrl(url: string | undefined): string {
		if (!url) return ''
		try {
			const parsed = new URL(url)
			if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
				return url
			}
		} catch {
			// Invalid URL
		}
		return ''
	}

	public formatJourneyStatus(status: TicketJourneyStatus): string {
		switch (status) {
			case TicketJourneyStatus.TRACKING:
				return 'トラッキング中'
			case TicketJourneyStatus.APPLIED:
				return '申し込み済'
			case TicketJourneyStatus.LOST:
				return '落選'
			case TicketJourneyStatus.UNPAID:
				return '当選（未払い）'
			case TicketJourneyStatus.PAID:
				return '支払済'
			default:
				return '不明'
		}
	}

	private detectEmailType(body: string): EmailType {
		if (/当選|落選|抽選結果/.test(body)) {
			return 'lottery_result'
		}
		return 'lottery_info'
	}
}
