import { HypeType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js'
import type { Hype } from '../../../entities/follow'

export function hypeFrom(proto: HypeType | undefined): Hype {
	switch (proto) {
		case HypeType.WATCH:
			return 'watch'
		case HypeType.HOME:
			return 'home'
		case HypeType.NEARBY:
			return 'nearby'
		case HypeType.AWAY:
			return 'away'
		default:
			return 'watch'
	}
}

export function hypeTo(hype: Hype): HypeType {
	switch (hype) {
		case 'watch':
			return HypeType.WATCH
		case 'home':
			return HypeType.HOME
		case 'nearby':
			return HypeType.NEARBY
		case 'away':
			return HypeType.AWAY
	}
}
