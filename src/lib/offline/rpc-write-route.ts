/**
 * True when `pathname` is a Connect RPC path `/<package>.<service>/<method>`
 * of `service` with a method in `methods`. The Service Worker uses it to send
 * only write RPCs through Background Sync.
 */
export function isRpcMethod(
	pathname: string,
	service: string,
	methods: ReadonlySet<string>,
): boolean {
	const slash = pathname.lastIndexOf('/')
	return (
		slash > 0 &&
		pathname.slice(0, slash).endsWith(`/${service}`) &&
		methods.has(pathname.slice(slash + 1))
	)
}

/** Artist RPCs a fan can make offline that are worth replaying. */
export const ARTIST_WRITES: ReadonlySet<string> = new Set(['Create'])

/** Follow RPCs a fan can make offline that are worth replaying. */
export const FOLLOW_WRITES: ReadonlySet<string> = new Set([
	'Follow',
	'Unfollow',
	'SetHype',
])
