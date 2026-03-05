import { bindable, resolve } from 'aurelia'
import { displayName } from '../../constants/iso3166'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { artistColor } from './color-generator'
import type { LiveEvent } from './live-event'

export class EventDetailSheet {
	@bindable public event: LiveEvent | null = null

	public isOpen = false
	public dragOffset = 0

	private dialogElement!: HTMLDialogElement
	private readonly onboarding = resolve(IOnboardingService)
	private touchStartY = 0
	private isDragging = false
	private readonly DISMISS_THRESHOLD = 100

	private get isDismissBlocked(): boolean {
		return this.onboarding.currentStep === OnboardingStep.DETAIL
	}

	public get backgroundColor(): string {
		if (!this.event) return 'hsl(0, 0%, 20%)'
		return artistColor(this.event.artistName)
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
		this.event = event
		this.isOpen = true
		this.dragOffset = 0
		this.dialogElement.showModal()
		history.pushState({ concertId: event.id }, '', `/concerts/${event.id}`)
	}

	public close(): void {
		this.isOpen = false
		this.dragOffset = 0
		this.dialogElement.close()
		history.replaceState(null, '', '/dashboard')
	}

	public onDialogClick(e: Event): void {
		if (e.target === this.dialogElement) {
			if (this.isDismissBlocked) return
			this.close()
		}
	}

	public onCancel(e: Event): void {
		if (this.isDismissBlocked) {
			e.preventDefault()
		}
	}

	public onSheetClick(e: Event): void {
		e.stopPropagation()
	}

	public onTouchStart(e: TouchEvent): void {
		if (!this.isOpen) return
		this.touchStartY = e.touches[0].clientY
		this.isDragging = true
	}

	public onTouchMove(e: TouchEvent): void {
		if (!this.isDragging) return
		if (this.isDismissBlocked) return
		const scrollable = this.dialogElement.querySelector('.overflow-y-auto')
		if (scrollable && scrollable.scrollTop > 0) {
			this.isDragging = false
			return
		}
		const deltaY = e.touches[0].clientY - this.touchStartY
		this.dragOffset = Math.max(0, deltaY)
	}

	public onTouchEnd(): void {
		if (!this.isDragging) return
		this.isDragging = false

		if (this.isDismissBlocked) {
			this.dragOffset = 0
			return
		}

		if (this.dragOffset > this.DISMISS_THRESHOLD) {
			this.close()
		} else {
			this.dragOffset = 0
		}
	}
}
