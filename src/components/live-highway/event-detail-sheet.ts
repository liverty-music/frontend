import { bindable, INode, resolve } from 'aurelia'
import { artistColor } from './color-generator'
import type { LiveEvent } from './live-event'

export class EventDetailSheet {
	@bindable public event: LiveEvent | null = null

	public isOpen = false

	private readonly element = resolve(INode) as HTMLElement

	public get backgroundColor(): string {
		if (!this.event) return 'hsl(0, 0%, 20%)'
		return artistColor(this.event.artistName)
	}

	public get formattedDate(): string {
		if (!this.event) return ''
		return this.event.date.toLocaleDateString('ja-JP', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			weekday: 'short',
		})
	}

	public get googleMapsUrl(): string {
		if (!this.event) return '#'
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(this.event.venueName)}`
	}

	public get calendarUrl(): string {
		if (!this.event) return '#'
		const e = this.event
		const dateStr = [
			e.date.getFullYear(),
			String(e.date.getMonth() + 1).padStart(2, '0'),
			String(e.date.getDate()).padStart(2, '0'),
		].join('')
		const startStr = e.startTime.replace(':', '') + '00'
		return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${dateStr}T${startStr}/${dateStr}T${startStr}&location=${encodeURIComponent(e.venueName)}`
	}

	public open(event: LiveEvent): void {
		this.event = event
		this.isOpen = true
	}

	public close(): void {
		this.isOpen = false
	}

	public onBackdropClick(): void {
		this.close()
	}

	public onSheetClick(e: Event): void {
		e.stopPropagation()
	}
}
