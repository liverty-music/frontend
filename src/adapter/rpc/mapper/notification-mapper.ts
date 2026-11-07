import type { Notification as NotificationProto } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/notification_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type { Notification } from '../../../entities/notification'

/** Map a listed Notification to the entity the notification center shows. */
export function notificationFrom(proto: NotificationProto): Notification {
	return {
		id: proto.id?.value ?? '',
		title: proto.message?.title ?? '',
		body: proto.message?.body ?? '',
		link: proto.message?.data.url ?? '/',
		createTime: proto.createTime
			? timestampDate(proto.createTime)
			: new Date(0),
		readTime: proto.readTime ? timestampDate(proto.readTime) : undefined,
	}
}
