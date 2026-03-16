import { IStore } from '@aurelia/state'
import { resolve } from 'aurelia'
import type { AppAction } from './actions'
import type { AppState } from './app-state'

export type IAppStore = IStore<AppState, AppAction>

export function resolveStore(): IAppStore {
	return resolve(IStore) as unknown as IAppStore
}
