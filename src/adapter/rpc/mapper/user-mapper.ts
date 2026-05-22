import type { User as ProtoUser } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import type { User } from '../../../entities/user'
import { isSupportedLanguage } from '../../../util/change-locale'

export function userFrom(proto: ProtoUser): User {
	const home = proto.home
	// Defend the UI against out-of-range values that may have slipped past
	// the backend protovalidate constraint (manual DB edit, future loosened
	// validation, schema drift). The settings selector only knows how to
	// render SUPPORTED_LANGUAGES; treating anything else as undefined here
	// makes the UI fall through to i18n.getLocale() instead of binding to a
	// non-existent translation key (e.g. `languages.fr`).
	const preferredLanguage =
		proto.preferredLanguage && isSupportedLanguage(proto.preferredLanguage)
			? proto.preferredLanguage
			: undefined
	return {
		id: proto.id?.value ?? '',
		home: home
			? {
					countryCode: home.countryCode,
					level1: home.level1,
					level2: home.level2 || undefined,
				}
			: undefined,
		preferredLanguage,
	}
}
