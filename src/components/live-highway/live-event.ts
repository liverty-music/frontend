export type LaneType = 'home' | 'nearby' | 'away'

export type HypeLevel = 'watch' | 'home' | 'nearby' | 'away'

export interface LiveEvent {
	id: string
	artistName: string
	artistId: string
	venueName: string
	locationLabel: string
	adminArea?: string
	date: Date
	startTime: string
	openTime?: string
	title: string
	sourceUrl: string
	hypeLevel: HypeLevel
	matched: boolean
}

export interface DateGroup {
	label: string
	dateKey: string
	home: LiveEvent[]
	nearby: LiveEvent[]
	away: LiveEvent[]
}
