import { describe, expect, it } from 'vitest'
import type { JourneyStatus } from './concert'
import {
	JOURNEY_STATUS_CONFIG,
	JOURNEY_STATUS_CONFIG_MAP,
} from './ticket-journey'

const ALL_STATUSES: readonly JourneyStatus[] = [
	'tracking',
	'applied',
	'unpaid',
	'paid',
	'lost',
]

describe('JOURNEY_STATUS_CONFIG', () => {
	// @spec components/infrastructure/fan/web/route/dashboard "Map covers every status"
	it('covers all five journey statuses exactly once', () => {
		const statuses = JOURNEY_STATUS_CONFIG.map((c) => c.status)
		expect(statuses).toHaveLength(ALL_STATUSES.length)
		expect(new Set(statuses)).toEqual(new Set(ALL_STATUSES))
	})

	it('reuses the existing eventDetail.journeyStatus.* i18n keys', () => {
		for (const config of JOURNEY_STATUS_CONFIG) {
			expect(config.labelKey).toBe(`eventDetail.journeyStatus.${config.status}`)
		}
	})

	// @spec components/infrastructure/fan/web/route/dashboard "Icon per status"
	it('assigns the specified emoji icon per status', () => {
		const iconByStatus = Object.fromEntries(
			JOURNEY_STATUS_CONFIG.map((c) => [c.status, c.icon]),
		)
		expect(iconByStatus).toEqual({
			tracking: '🔔',
			applied: '📝',
			unpaid: '💰',
			paid: '🎟️',
			lost: '💔',
		})
	})

	// @spec components/infrastructure/fan/web/route/dashboard "Hue per status"
	it('points each status at its shared journey-hue token', () => {
		for (const config of JOURNEY_STATUS_CONFIG) {
			expect(config.hueToken).toBe(`--journey-hue-${config.status}`)
		}
	})

	it('exposes a by-status lookup covering every status', () => {
		for (const status of ALL_STATUSES) {
			expect(JOURNEY_STATUS_CONFIG_MAP[status].status).toBe(status)
		}
	})
})
