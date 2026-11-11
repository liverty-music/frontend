import { beforeEach, describe, expect, it } from 'vitest'
import {
	clearTicketPresets,
	loadTicketPreset,
	saveTicketPreset,
} from '../../../src/adapter/storage/ticket-preset-storage'
import { StorageKeys } from '../../../src/constants/storage-keys'

describe('ticket preset storage', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	it('keeps the design of each ticket and reads it back', () => {
		expect(loadTicketPreset('ticket-1')).toBe('default')

		saveTicketPreset('ticket-1', 'jazz')
		saveTicketPreset('ticket-2', 'rock')

		expect(loadTicketPreset('ticket-1')).toBe('jazz')
		expect(loadTicketPreset('ticket-2')).toBe('rock')
		expect(loadTicketPreset('ticket-3')).toBe('default')
	})

	it('keeps nothing for the default design', () => {
		saveTicketPreset('ticket-1', 'jazz')
		saveTicketPreset('ticket-1', 'default')

		expect(loadTicketPreset('ticket-1')).toBe('default')
		expect(localStorage.getItem(StorageKeys.ticketPresets)).toBe('{}')
	})

	it('reads a malformed or unknown value as the default design', () => {
		localStorage.setItem(StorageKeys.ticketPresets, 'not json')
		expect(loadTicketPreset('ticket-1')).toBe('default')

		localStorage.setItem(
			StorageKeys.ticketPresets,
			JSON.stringify({ 'ticket-1': 'polka', 'ticket-2': 7 }),
		)
		expect(loadTicketPreset('ticket-1')).toBe('default')
		expect(loadTicketPreset('ticket-2')).toBe('default')
		// A name every object has is not a design.
		expect(loadTicketPreset('constructor')).toBe('default')
	})

	it('forgets every design when cleared', () => {
		saveTicketPreset('ticket-1', 'jazz')

		clearTicketPresets()

		expect(loadTicketPreset('ticket-1')).toBe('default')
	})
})
