import type { User as ProtoUser } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import type { User } from '../../../entities/user'

export function userFrom(proto: ProtoUser): User {
	const home = proto.home
	// TODO(persist-user-language): swap to generated type after BSR gen.
	// The current pinned BSR package does not yet expose `preferredLanguage`
	// on `ProtoUser`. Once the schema Release ships, the cast below can be
	// removed and `proto.preferredLanguage` accessed directly.
	const preferredLanguage = (proto as unknown as { preferredLanguage?: string })
		.preferredLanguage
	return {
		id: proto.id?.value ?? '',
		home: home
			? {
					countryCode: home.countryCode,
					level1: home.level1,
					level2: home.level2 || undefined,
				}
			: undefined,
		preferredLanguage:
			typeof preferredLanguage === 'string' && preferredLanguage.length > 0
				? preferredLanguage
				: undefined,
	}
}
