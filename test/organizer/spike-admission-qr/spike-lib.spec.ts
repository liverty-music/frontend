import { DI, ILogger, Registration } from 'aurelia'
import { describe, expect, it } from 'vitest'
import { SpikeAdmissionQrRoute } from '../../../organizer/spike-admission-qr/spike-admission-qr-route'
import {
	buildRun,
	checkLayout,
	isSpikeEnabled,
	loadRuns,
	RUNS_STORAGE_KEY,
	saveRuns,
} from '../../../organizer/spike-admission-qr/spike-lib'
import { IAppConfig } from '../../../shared/config/app-config'
import {
	buildSignedBytes,
	encodeAdmissionCode,
} from '../../../shared/lib/admission-code/admission-code'
import { base45Encode } from '../../../shared/lib/admission-code/base45'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockLogger } from '../../helpers/mock-logger'

const ticket = (i: number) =>
	`019a0000-0000-7000-8000-${String(i).padStart(12, '0')}`

function codeFor(count: number): string {
	return encodeAdmissionCode(
		buildSignedBytes({
			userId: ticket(900),
			eventId: ticket(901),
			ticketIds: Array.from({ length: count }, (_, i) => ticket(i + 1)),
			signTime: 1_791_000_000,
		}),
		new Uint8Array(64).fill(1),
	)
}

describe('isSpikeEnabled', () => {
	it.each([
		['dev', true],
		['staging', false],
		['prod', false],
	] as const)('environment %s → %s', (environment, expected) => {
		expect(isSpikeEnabled({ environment })).toBe(expected)
	})

	it('is off without a config', () => {
		expect(isSpikeEnabled(undefined)).toBe(false)
	})

	it.each([
		['dev', true],
		['prod', false],
	] as const)('the route loads only in dev (%s → %s)', (environment, expected) => {
		const container = DI.createContainer()
		container.register(
			Registration.instance(ILogger, createMockLogger()),
			Registration.instance(IAppConfig, createMockAppConfig({ environment })),
		)
		container.register(SpikeAdmissionQrRoute)
		const route = container.get(SpikeAdmissionQrRoute)
		expect(route.enabled).toBe(expected)
		expect(route.canLoad()).toBe(expected)
	})
})

describe('checkLayout', () => {
	it.each([1, 3, 10])('accepts a code for %i tickets', (count) => {
		const result = checkLayout(codeFor(count))
		expect(result).toEqual({
			ok: true,
			ticketCount: count,
			bytes: 102 + 16 * count,
		})
	})

	it('rejects text that is not Base45', () => {
		expect(checkLayout('https://example.com/')).toEqual({
			ok: false,
			reason: 'not-base45',
		})
	})

	it('rejects Base45 that is not the layout', () => {
		expect(checkLayout(base45Encode(new Uint8Array(117)))).toEqual({
			ok: false,
			reason: 'bad-layout',
		})
	})
})

describe('runs', () => {
	const run = buildRun({
		decoder: 'paulmillr-worker',
		ticketCount: 3,
		startedAt: 1000.2,
		decodedAt: 1450.7,
		frames: 12,
		failures: 10,
		ignored: 1,
		brightness: 'low',
		userAgent: 'UA',
		now: new Date('2026-10-08T09:00:00Z'),
	})

	it('builds a record with whole milliseconds', () => {
		expect(run).toEqual({
			decoder: 'paulmillr-worker',
			ticketCount: 3,
			ms: 451,
			frames: 12,
			failures: 10,
			ignored: 1,
			brightness: 'low',
			userAgent: 'UA',
			timestamp: '2026-10-08T09:00:00.000Z',
		})
	})

	it('round-trips through storage and tolerates bad data', () => {
		const store = new Map<string, string>()
		const storage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => {
				store.set(k, v)
			},
		}
		saveRuns(storage, [run])
		expect(loadRuns(storage)).toEqual([run])

		store.set(RUNS_STORAGE_KEY, '{not json')
		expect(loadRuns(storage)).toEqual([])
		store.set(RUNS_STORAGE_KEY, '{"a":1}')
		expect(loadRuns(storage)).toEqual([])
		expect(loadRuns(undefined)).toEqual([])
		expect(() =>
			saveRuns(
				{
					setItem: () => {
						throw new Error('quota')
					},
				},
				[run],
			),
		).not.toThrow()
	})
})
