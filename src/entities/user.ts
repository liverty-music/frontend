/**
 * A user's home area setting.
 * @source proto/liverty_music/entity/v1/user.proto — Home
 */
export interface UserHome {
	readonly countryCode: string
	readonly level1: string
	readonly level2?: string
}

/**
 * A registered user in the system.
 * @source proto/liverty_music/entity/v1/user.proto — User
 */
export interface User {
	readonly home?: UserHome
}
