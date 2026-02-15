export type LaneType = 'main' | 'region' | 'other'

export interface LiveEvent {
	id: string
	artistName: string
	artistId: string
	venueName: string
	locationLabel: string
	date: Date
	startTime: string
	openTime?: string
	title: string
	sourceUrl: string
}

export interface DateGroup {
	label: string
	dateKey: string
	main: LiveEvent[]
	region: LiveEvent[]
	other: LiveEvent[]
}
