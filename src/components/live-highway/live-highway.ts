import { bindable } from 'aurelia'
import type { EventDetailSheet } from './event-detail-sheet'
import type { DateGroup, LiveEvent } from './live-event'

export class LiveHighway {
	@bindable public dateGroups: DateGroup[] = []
	@bindable public loading = false

	public detailSheet!: EventDetailSheet

	public get isEmpty(): boolean {
		return this.dateGroups.length === 0
	}

	public onEventSelected(event: CustomEvent<{ event: LiveEvent }>): void {
		this.detailSheet.open(event.detail.event)
	}
}
