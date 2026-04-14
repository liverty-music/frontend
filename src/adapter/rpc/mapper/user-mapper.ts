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
	}
}
