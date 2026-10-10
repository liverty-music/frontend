import { describe, expect, it } from 'vitest'
import {
	blankFormModel,
	isFormValid,
	parseJstDateTimeLocal,
	type TicketSaleFormContext,
	type TicketSaleFormModel,
	toConfigureInput,
	toJstDateTimeLocal,
	validateTicketSaleForm,
} from '../../../organizer/ticket-sale-editor/ticket-sale-form'

/** 2026-11-20 19:00 in Japan time. */
const EVENT_START = new Date(Date.UTC(2026, 10, 20, 10, 0))
const CTX: TicketSaleFormContext = {
	eventStart: EVENT_START,
	soldCount: 0,
	heldCount: 0,
}

function valid(): TicketSaleFormModel {
	return {
		saleStart: '2026-11-01T12:00',
		saleEnd: '2026-11-20T19:00',
		price: '3000',
		quantity: '150',
		perAccountLimit: '4',
	}
}

describe('Japan-time inputs', () => {
	it('reads a datetime-local value as Japan time whatever the browser zone', () => {
		expect(parseJstDateTimeLocal('2026-11-20T19:00')?.toISOString()).toBe(
			'2026-11-20T10:00:00.000Z',
		)
		// Crossing midnight in UTC.
		expect(parseJstDateTimeLocal('2026-11-21T08:30')?.toISOString()).toBe(
			'2026-11-20T23:30:00.000Z',
		)
	})

	it('formats an instant as a Japan-time datetime-local value', () => {
		expect(toJstDateTimeLocal(EVENT_START)).toBe('2026-11-20T19:00')
		expect(toJstDateTimeLocal(new Date('2026-11-20T23:30:00Z'))).toBe(
			'2026-11-21T08:30',
		)
	})

	it('rejects blank, malformed and non-existent times', () => {
		expect(parseJstDateTimeLocal('')).toBeNull()
		expect(parseJstDateTimeLocal('2026-11-20 19:00')).toBeNull()
		expect(parseJstDateTimeLocal('2026-02-30T10:00')).toBeNull()
		expect(parseJstDateTimeLocal('2026-11-20T24:00')).toBeNull()
	})
})

describe('blankFormModel', () => {
	it('ends the sale at the event start and allows 4 per account', () => {
		const model = blankFormModel(EVENT_START)
		expect(model.saleEnd).toBe('2026-11-20T19:00')
		expect(model.perAccountLimit).toBe('4')
		expect(model.saleStart).toBe('')
	})
})

describe('validateTicketSaleForm', () => {
	it('accepts a valid sale ending exactly at the event start', () => {
		expect(isFormValid(validateTicketSaleForm(valid(), CTX))).toBe(true)
	})

	it('rejects a sale end after the event start', () => {
		const errors = validateTicketSaleForm(
			{ ...valid(), saleEnd: '2026-11-20T19:30' },
			CTX,
		)
		expect(errors.saleEnd).toContain('2026-11-20 19:00')
	})

	it('rejects an end that is not after the start', () => {
		const errors = validateTicketSaleForm(
			{ ...valid(), saleStart: '2026-11-20T19:00' },
			CTX,
		)
		expect(errors.saleEnd).toContain('販売開始より後')
	})

	it('requires both times', () => {
		const errors = validateTicketSaleForm(
			{ ...valid(), saleStart: '', saleEnd: '' },
			CTX,
		)
		expect(errors.saleStart).toBeDefined()
		expect(errors.saleEnd).toBeDefined()
	})

	it.each([
		['0', true],
		['1', false],
		['1000000', false],
		['1000001', true],
		['12.5', true],
		['', true],
	])('price %s is an error: %s', (price, isError) => {
		const errors = validateTicketSaleForm({ ...valid(), price }, CTX)
		expect(Boolean(errors.price)).toBe(isError)
	})

	it.each([
		['0', true],
		['1', false],
		['', true],
	])('quantity %s is an error: %s', (quantity, isError) => {
		const errors = validateTicketSaleForm({ ...valid(), quantity }, CTX)
		expect(Boolean(errors.quantity)).toBe(isError)
	})

	it.each([
		['0', true],
		['1', false],
		['10', false],
		['11', true],
	])('limit %s is an error: %s', (perAccountLimit, isError) => {
		const errors = validateTicketSaleForm({ ...valid(), perAccountLimit }, CTX)
		expect(Boolean(errors.perAccountLimit)).toBe(isError)
	})

	it('refuses a quantity below sold plus held and accepts it at the floor', () => {
		const ctx = { ...CTX, soldCount: 100, heldCount: 6 }
		expect(
			validateTicketSaleForm({ ...valid(), quantity: '105' }, ctx).quantity,
		).toContain('106枚')
		expect(
			validateTicketSaleForm({ ...valid(), quantity: '106' }, ctx).quantity,
		).toBeUndefined()
	})
})

describe('toConfigureInput', () => {
	it('converts the model into absolute instants and numbers', () => {
		const input = toConfigureInput('event-1', valid())
		expect(input).toEqual({
			eventId: 'event-1',
			saleStartTime: new Date('2026-11-01T03:00:00Z'),
			saleEndTime: EVENT_START,
			price: 3000,
			quantity: 150,
			perAccountLimit: 4,
		})
	})
})
