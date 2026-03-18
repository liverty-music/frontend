// Stub for unpublished BSR proto types (ticket_journey_pb, ticket_pb, ticket_journey_service_connect)
// Remove this file once the proto types are published to BSR

export class EventId {
	constructor(init) {
		this.value = init?.value ?? ''
	}
}

export const TicketJourneyStatus = {
	UNSPECIFIED: 0,
	TRACKING: 1,
	APPLIED: 2,
	LOST: 3,
	UNPAID: 4,
	PAID: 5,
}

export class TicketJourney {
	constructor() {
		this.eventId = undefined
		this.status = 0
	}
}

export const TicketJourneyService = {
	typeName: 'liverty_music.rpc.ticket_journey.v1.TicketJourneyService',
	methods: {},
}
