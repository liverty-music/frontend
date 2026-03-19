import type { ILogger } from 'aurelia'
import {
	deserializeGuestFollows,
	serializeGuestFollows,
} from '../adapter/storage/guest-storage'
import { normalizeStep } from '../entities/onboarding'
import type { AppState, GuestFollow } from './app-state'

const STORAGE_KEY_ONBOARDING_STEP = 'onboardingStep'
const STORAGE_KEY_GUEST_FOLLOWED = 'guest.followedArtists'
const STORAGE_KEY_GUEST_HOME = 'guest.home'

export function persistenceMiddleware(
	currentState: AppState,
	_action: unknown,
): AppState {
	localStorage.setItem(
		STORAGE_KEY_ONBOARDING_STEP,
		currentState.onboarding.step,
	)

	localStorage.setItem(
		STORAGE_KEY_GUEST_FOLLOWED,
		serializeGuestFollows(currentState.guest.follows),
	)

	if (currentState.guest.home !== null) {
		localStorage.setItem(STORAGE_KEY_GUEST_HOME, currentState.guest.home)
	} else {
		localStorage.removeItem(STORAGE_KEY_GUEST_HOME)
	}

	return currentState
}

export function createLoggingMiddleware(logger: ILogger) {
	return (currentState: AppState, action: unknown): AppState => {
		const a = action as { type?: string }
		logger.info('[Store]', a.type ?? 'unknown')
		return currentState
	}
}

export function loadPersistedState(): Partial<AppState> {
	const result: Partial<AppState> = {}

	const rawStep = localStorage.getItem(STORAGE_KEY_ONBOARDING_STEP)
	if (rawStep !== null) {
		const step = normalizeStep(rawStep)
		if (step !== rawStep) {
			localStorage.setItem(STORAGE_KEY_ONBOARDING_STEP, step)
		}
		result.onboarding = {
			step,
			spotlightTarget: '',
			spotlightMessage: '',
			spotlightRadius: '12px',
			spotlightActive: false,
		}
	}

	const rawFollowed = localStorage.getItem(STORAGE_KEY_GUEST_FOLLOWED)
	const rawHome = localStorage.getItem(STORAGE_KEY_GUEST_HOME)
	if (rawFollowed !== null || rawHome !== null) {
		let follows: GuestFollow[] = []
		if (rawFollowed) {
			follows = deserializeGuestFollows(rawFollowed)
		}
		result.guest = {
			follows,
			home: rawHome,
		}
	}

	return result
}
