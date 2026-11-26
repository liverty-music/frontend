import { instantToWall } from '../../shared/lib/zoned-time/zoned-time'

/**
 * The wall-clock time at a Venue in Tokyo of an instant, as a fixture's
 * `TimeOfDay` (`hours`, `minutes`) and as the app's `WallTime`
 * (`hour`, `minute`).
 */
export function tokyoTimeOfDay(instant: Date) {
	const { hour, minute } = instantToWall(instant, 'Asia/Tokyo')
	return { hours: hour, minutes: minute }
}
