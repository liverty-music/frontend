import { bindable, ILogger, resolve } from 'aurelia'
import { displayName } from '../../constants/iso3166'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { ITicketJourneyService } from '../../services/ticket-journey-service'
import type { JourneyStatus, LiveEvent } from './live-event'

export class EventDetailSheet {
	@bindable public event: LiveEvent | null = null

	public isOpen = false
	public journeyUpdating = false

	private readonly logger = resolve(ILogger).scopeTo('EventDetailSheet')
	private readonly onboarding = resolve(IOnboardingService)
	private readonly journeyService = resolve(ITicketJourneyService)
	private closedByPopstate = false

	private readonly onPopstate = (): void => {
		if (this.isOpen) {
			// Browser navigated back — mark so onSheetClosed skips replaceState
			this.closedByPopstate = true
			this.isOpen = false
			window.removeEventListener('popstate', this.onPopstate)
		}
	}

	public get isDismissable(): boolean {
		return this.onboarding.currentStep !== OnboardingStep.DETAIL
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
		this.closedByPopstate = false
		this.event = event
		this.isOpen = true

		window.addEventListener('popstate', this.onPopstate)
		history.pushState({ concertId: event.id }, '', `/concerts/${event.id}`)
	}

	/** Programmatic close — replaces history state back to dashboard */
	public close(): void {
		if (!this.isOpen) return
		this.isOpen = false
		window.removeEventListener('popstate', this.onPopstate)
		history.replaceState(null, '', '/dashboard')
	}

	/** Handles the sheet-closed event dispatched by <bottom-sheet> on light-dismiss or swipe */
	public onSheetClosed(): void {
		if (this.closedByPopstate) {
			this.closedByPopstate = false
			return
		}
		this.isOpen = false
		window.removeEventListener('popstate', this.onPopstate)
		history.replaceState(null, '', '/dashboard')
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

	/** Unconditional cleanup on component detach to prevent listener leaks */
	public detaching(): void {
		window.removeEventListener('popstate', this.onPopstate)
	}
}
