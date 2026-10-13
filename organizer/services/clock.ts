import { DI } from 'aurelia'

/** The current time, injectable so tests can fix it. */
export class Clock {
	public now(): number {
		return Date.now()
	}
}

export const IClock = DI.createInterface<IClock>('IClock', (x) =>
	x.singleton(Clock),
)
export interface IClock extends Clock {}
