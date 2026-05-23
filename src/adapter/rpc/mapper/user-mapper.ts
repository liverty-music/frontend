import type { User as ProtoUser } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import type { User } from '../../../entities/user'

export function userFrom(proto: ProtoUser): User {
	const home = proto.home
	return {
		id: proto.id?.value ?? '',
		home: home
			? {
					countryCode: home.countryCode,
					level1: home.level1,
					level2: home.level2 || undefined,
				}
			: undefined,
		// Pass through whatever the backend stored — coercing unsupported
		// values to `undefined` here would let the hydration backfill path
		// overwrite the stored value (the user's true preference) with the
		// client's detected locale, silently destroying data. The settings
		// UI handles "current locale not in SUPPORTED_LANGUAGES" by not
		// highlighting any selector option, which is the right "show, don't
		// hide" posture for an unexpected DB state.
		preferredLanguage: proto.preferredLanguage || undefined,
	}
}
