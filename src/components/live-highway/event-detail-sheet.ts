import { bindable, resolve } from 'aurelia'
import { displayName } from '../../constants/iso3166'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import type { LiveEvent } from './live-event'

export class EventDetailSheet {
	@bindable public event: LiveEvent | null = null

	public isOpen = false

	private readonly onboarding = resolve(IOnboardingService)

	private readonly onPopstate = (): void => {
		if (this.isOpen) {
			// Browser navigated back — close without touching history
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
		this.isOpen = false
		window.removeEventListener('popstate', this.onPopstate)
		history.replaceState(null, '', '/dashboard')
	}

	/** Unconditional cleanup on component detach to prevent listener leaks */
	public detaching(): void {
		window.removeEventListener('popstate', this.onPopstate)
	}
}
