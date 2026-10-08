import {
	TicketSchema,
	TicketStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { countIssuedByEvent } from '../../src/services/purchased-ticket-store'

function ticket(eventId: string, status: TicketStatus) {
	return create(TicketSchema, { eventId: { value: eventId }, status })
}

describe('countIssuedByEvent', () => {
	it('counts Issued tickets per event', () => {
		// @spec components/infrastructure/fan/web/route/event "Fan holding two tickets"
		const counts = countIssuedByEvent([
			ticket('ev-1', TicketStatus.ISSUED),
			ticket('ev-1', TicketStatus.ISSUED),
			ticket('ev-2', TicketStatus.ISSUED),
		])
		expect(counts.get('ev-1')).toBe(2)
		expect(counts.get('ev-2')).toBe(1)
	})

	it('does not count Voided tickets', () => {
		// @spec components/infrastructure/fan/web/route/event "Voided tickets are not counted"
		const counts = countIssuedByEvent([ticket('ev-1', TicketStatus.VOIDED)])
		expect(counts.has('ev-1')).toBe(false)
	})
})
