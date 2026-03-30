import type { IDisposable } from '@aurelia/kernel'
import { IRouter, IRouterEvents } from '@aurelia/router'
import { bindable, ILogger, resolve } from 'aurelia'
import { displayName } from '../../constants/iso3166'
import { bestBackgroundUrl } from '../../entities/artist'
import { IAuthService } from '../../services/auth-service'
import { ITicketJourneyService } from '../../services/ticket-journey-service'
import type { JourneyStatus, LiveEvent } from './live-event'

export class EventDetailSheet {
	@bindable public event: LiveEvent | null = null

	public isOpen = false
	public journeyUpdating = false

	private readonly logger = resolve(ILogger).scopeTo('EventDetailSheet')
	private readonly journeyService = resolve(ITicketJourneyService)
	private readonly authService = resolve(IAuthService)
	private readonly router = resolve(IRouter)
	private readonly routerEvents = resolve(IRouterEvents)
	private navSub: IDisposable | null = null

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	public get backgroundUrl(): string | undefined {
		return bestBackgroundUrl(this.event?.artist)
	}

	public get googleMapsUrl(): string {
		if (!this.event) return '#'
		const area = this.event.adminArea ? displayName(this.event.adminArea) : ''
		const query = area
			? `${this.event.venueName} ${area}`
			: this.event.venueName
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
	}

	public get calendarUrl(): string {
		if (!this.event) return '#'
		const e = this.event
		const dateStr = [
			e.date.getFullYear(),
			String(e.date.getMonth() + 1).padStart(2, '0'),
			String(e.date.getDate()).padStart(2, '0'),
		].join('')
		const startTime = e.startTime || '19:00'
		const startStr = `${startTime.replace(':', '')}00`
		const [hours, mins] = startTime.split(':').map(Number)
		const endDate = new Date(e.date)
		endDate.setHours(hours + 2, mins)
		const endDateStr = [
			endDate.getFullYear(),
			String(endDate.getMonth() + 1).padStart(2, '0'),
			String(endDate.getDate()).padStart(2, '0'),
		].join('')
		const endStr = `${String(endDate.getHours()).padStart(2, '0')}${String(endDate.getMinutes()).padStart(2, '0')}00`
		return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${dateStr}T${startStr}/${endDateStr}T${endStr}&location=${encodeURIComponent(e.venueName)}`
	}

	/** Open the sheet for a given event, pushing a history entry for deep-link support */
	public open(event: LiveEvent): void {
		this.event = event
		this.isOpen = true

		// Navigate via Aurelia Router so history is managed by the framework.
		// historyStrategy: 'push' adds a back-navigable entry.
		void this.router.load(`concerts/${event.id}`, { historyStrategy: 'push' })

		// Subscribe to router navigation-end to detect back navigation.
		// When the user navigates away from /concerts/:id (e.g. browser back),
		// close the sheet without issuing another navigation.
		this.navSub = this.routerEvents.subscribe(
			'au:router:navigation-end',
			(e) => {
				const path = e.finalInstructions.toPath()
				if (this.isOpen && !path.startsWith('concerts/')) {
					this.isOpen = false
					this.navSub?.dispose()
					this.navSub = null
				}
			},
		)
	}

	/** Programmatic close — navigates back to dashboard */
	public close(): void {
		if (!this.isOpen) return
		this.isOpen = false
		this.navSub?.dispose()
		this.navSub = null
		void this.router.load('dashboard', { historyStrategy: 'replace' })
	}

	/** Handles the sheet-closed event dispatched by <bottom-sheet> on light-dismiss or swipe */
	public onSheetClosed(): void {
		this.close()
	}

	public get journeyStatuses(): JourneyStatus[] {
		return ['tracking', 'applied', 'lost', 'unpaid', 'paid']
	}

	public async setJourneyStatus(status: JourneyStatus): Promise<void> {
		if (!this.event || this.journeyUpdating) return
		this.journeyUpdating = true
		try {
			await this.journeyService.setStatus(this.event.id, status)
			this.event.journeyStatus = status
		} catch (err) {
			this.logger.warn('Failed to set journey status', { error: err })
		} finally {
			this.journeyUpdating = false
		}
	}

	public async removeJourney(): Promise<void> {
		if (!this.event || this.journeyUpdating) return
		this.journeyUpdating = true
		try {
			await this.journeyService.delete(this.event.id)
			this.event.journeyStatus = undefined
		} catch (err) {
			this.logger.warn('Failed to remove journey', { error: err })
		} finally {
			this.journeyUpdating = false
		}
	}

	/** Unconditional cleanup on component detach to prevent subscription leaks */
	public detaching(): void {
		this.navSub?.dispose()
		this.navSub = null
	}
}
