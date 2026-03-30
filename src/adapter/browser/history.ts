import { DI } from 'aurelia'

export interface IHistory {
	pushState(data: unknown, unused: string, url: string): void
	replaceState(data: unknown, unused: string, url: string): void
}

export const IHistory = DI.createInterface<IHistory>('IHistory', (x) =>
	x.instance(window.history),
)
