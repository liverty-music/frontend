import { DI } from 'aurelia'

export interface ILocalStorage {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}

export const ILocalStorage = DI.createInterface<ILocalStorage>(
	'ILocalStorage',
	(x) => x.instance(window.localStorage),
)
