import { describe, expect, it } from 'vitest'
// The `name`, `name_en` and `name_ja` of every row the backend seeds into
// `time_zones`, copied from
// `k8s/atlas/base/reference-data/20261124120100_seed_areas.sql` (an empty third
// column is NULL). Copy it again when the backend moves to another CLDR release.
import seed from './backend-seed-time-zones.tsv?raw'
import { zoneLabel, zoneName } from './zone-name'

const seeded = seed
	.trimEnd()
	.split('\n')
	.map((line) => line.split('\t'))

describe('zoneName', () => {
	it('names every zone the backend seeds as the backend does', () => {
		expect(seeded).toHaveLength(418)
		expect(
			seeded.map(([zone]) => [
				zone,
				zoneName(zone, 'en'),
				zoneName(zone, 'ja'),
			]),
		).toEqual(
			// A zone without a Japanese name is shown with its English one.
			seeded.map(([zone, en, ja]) => [zone, en, ja || en]),
		)
	})

	it('names a zone CLDR does not list from its IANA name', () => {
		expect(zoneName('Mars/Olympus_Mons', 'ja')).toBe('Olympus Mons')
		expect(zoneName('Mars/Olympus_Mons', 'en')).toBe('Olympus Mons')
	})
})

describe('zoneLabel', () => {
	it('names a zone by its city, and Asia/Tokyo as Japan', () => {
		expect(zoneLabel('Asia/Tokyo', 'ja')).toBe('日本時間')
		expect(zoneLabel('Asia/Tokyo', 'en')).toBe('Japan time')
		expect(zoneLabel('Asia/Taipei', 'ja')).toBe('台北時間')
		expect(zoneLabel('America/Los_Angeles', 'en')).toBe('Los Angeles time')
	})
})
