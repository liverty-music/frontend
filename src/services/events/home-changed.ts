/**
 * The person's home area changed: a signed-in fan's SetHome succeeded, or a
 * guest chose a home on the device.
 *
 * Published by `UserStore`. `ConcertStore` drops its cached follower concert
 * lists on it, because the server places each concert in a lane by its
 * distance from the home, and those lists are cached by date only.
 */
export class HomeChanged {}
