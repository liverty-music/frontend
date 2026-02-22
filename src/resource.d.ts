declare module '*.html' {
	import { IContainer, PartialBindableDefinition } from 'aurelia'
	export const name: string
	export const template: string
	export default template
	export const dependencies: string[]
	export const containerless: boolean | undefined
	export const bindables: Record<string, PartialBindableDefinition>
	export const shadowOptions: { mode: 'open' | 'closed' } | undefined
	export function register(container: IContainer): void
}

// Vite-specific declarations for ?inline imports that return CSS as strings
declare module '*.css?inline' {
	const content: string
	export default content
}

declare module '*.css'

// Temporary stub for push notification service until the proto is published to BSR.
// Remove this declaration once @buf/liverty-music_schema.connectrpc_es includes
// the push_notification/v1 package.
declare module '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/push_notification/v1/push_notification_service_connect.js' {
	import type { MethodKind } from '@bufbuild/protobuf'

	interface SubscribeRequest {
		endpoint: string
		p256dh: string
		auth: string
	}

	interface SubscribeResponse {}

	interface UnsubscribeRequest {}

	interface UnsubscribeResponse {}

	export const PushNotificationService: {
		readonly typeName: 'liverty_music.rpc.push_notification.v1.PushNotificationService'
		readonly methods: {
			readonly subscribe: {
				readonly name: 'Subscribe'
				readonly I: typeof SubscribeRequest
				readonly O: typeof SubscribeResponse
				readonly kind: MethodKind.Unary
			}
			readonly unsubscribe: {
				readonly name: 'Unsubscribe'
				readonly I: typeof UnsubscribeRequest
				readonly O: typeof UnsubscribeResponse
				readonly kind: MethodKind.Unary
			}
		}
	}
}
