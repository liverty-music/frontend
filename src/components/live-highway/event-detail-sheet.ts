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

	private sheetElement!: HTMLDialogElement
	private scrollWrapper!: HTMLElement
	private triggerElement: HTMLElement | null = null
	private closedByPopstate = false

	private readonly onboarding = resolve(IOnboardingService)

	private readonly onPopstate = (): void => {
		if (this.isOpen) {
			this.closedByPopstate = true
			this.close()
		}
	}

	private readonly onToggle = (e: ToggleEvent): void => {
		// Fires when popover="auto" light-dismisses the sheet (Escape, click outside)
		if (e.newState === 'closed' && this.isOpen) {
			this.isOpen = false
			this.triggerElement?.focus()
			this.triggerElement = null
			window.removeEventListener('popstate', this.onPopstate)
			history.replaceState(null, '', '/dashboard')
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

	public open(event: LiveEvent): void {
		this.triggerElement = document.activeElement as HTMLElement | null
		this.event = event
		this.isOpen = true
		this.closedByPopstate = false

		// Dynamic popover mode: manual during onboarding Step 4 (non-dismissible),
		// auto otherwise (free light dismiss: Escape, click-outside, Android back)
		this.sheetElement.popover = this.isDismissable ? 'auto' : 'manual'

		this.sheetElement.style.setProperty('--_backdrop-opacity', '1')
		this.sheetElement.showPopover()
		this.sheetElement.focus()

		// Scroll to the card page (page 2); dismiss zone sits above at scrollTop=0
		this.scrollWrapper.scrollTop = this.scrollWrapper.scrollHeight

		window.addEventListener('popstate', this.onPopstate)
		this.sheetElement.addEventListener('toggle', this.onToggle)

		history.pushState({ concertId: event.id }, '', `/concerts/${event.id}`)
	}

	public close(): void {
		this.isOpen = false

		this.sheetElement.style.removeProperty('--_backdrop-opacity')

		try {
			this.sheetElement.hidePopover()
		} catch {
			// Popover may already be hidden by light dismiss
		}

		this.sheetElement.removeEventListener('toggle', this.onToggle)
		window.removeEventListener('popstate', this.onPopstate)

		this.triggerElement?.focus()
		this.triggerElement = null

		// Skip history manipulation when the browser already navigated back
		if (!this.closedByPopstate) {
			history.replaceState(null, '', '/dashboard')
		}
		this.closedByPopstate = false
	}

	/**
	 * Unconditional cleanup on component detach.
	 * Navigating away while the sheet is open skips close(), so listeners
	 * must be removed here to prevent leaks and GC retention.
	 */
	public detaching(): void {
		window.removeEventListener('popstate', this.onPopstate)
		this.sheetElement.removeEventListener('toggle', this.onToggle)
	}

	/** Click on the transparent area above the card — scroll to dismiss zone for unified fade-out */
	public onBackdropClick(): void {
		if (this.isDismissable) {
			this.scrollWrapper.scrollTo({ top: 0, behavior: 'smooth' })
		}
	}

	/** Fade backdrop in real-time as the user swipes toward the dismiss zone */
	public onScroll(e: Event): void {
		if (!this.isOpen) return
		const el = e.target as HTMLElement
		const maxScroll = el.scrollHeight - el.clientHeight
		if (maxScroll <= 0) return
		const progress = el.scrollTop / maxScroll
		this.sheetElement.style.setProperty('--_backdrop-opacity', String(progress))
	}

	/** CSS scroll snap dismiss: close when swiped down to the dismiss zone */
	public onScrollEnd(e: Event): void {
		const el = e.target as HTMLElement
		const maxScroll = el.scrollHeight - el.clientHeight
		if (maxScroll > 0 && el.scrollTop < maxScroll) {
			this.close()
		}
	}
}
