export const StorageKeys = {
	// Retired: the count of unanswered hype-change push offers, when the offer
	// stopped at 3. The offer has no limit now; main.ts removes the key on
	// startup.
	pushOfferDeclines: 'push.offerDeclines',
	pwaInstalled: 'pwa.installed',
	postSignupShown: 'postSignup.shown',
	// Celebration shown-once flag (guest light tier on first dashboard arrival).
	// Shared with the E2E suite, which seeds/removes this key to control the
	// celebration overlay's visibility.
	celebrationShown: 'onboarding.celebrationShown',
	// Collapsed onboarding-complete flag (single-flag onboarding state). Absent
	// key means the user is still onboarding.
	onboardingComplete: 'onboardingComplete',
	// Discovery bubble sound-effect preferences. '1'/'0' for mute, '0'..'1' for volume.
	soundMuted: 'sound.muted',
	soundVolume: 'sound.volume',
	// Laser beam spotlight effect on dashboard. 'true'/'false', defaults to off.
	beamsEnabled: 'beams.enabled',
	// FAB action-launcher placement (left-handed mode). 'left'/'right',
	// defaults to 'right' (bottom-right corner). Mirrors the beam preference.
	fabHanded: 'fab.handed',
	// The Discovery view used last on this device: 'artists' (the bubbles) or
	// 'nearby' (the All Nearby view). Absent means the bubbles.
	discoveryView: 'discovery.view',
	// The All Nearby view's filter kept for the next visit: JSON
	// { areaCode, datePreset } (see nearby-filter-storage.ts). Cleared on
	// sign-in, sign-up and sign-out.
	nearbyFilter: 'discovery.nearbyFilter',
	// The language last applied on this device, in every auth state; the
	// i18next detector reads it on boot (see FanI18nConfiguration).
	language: 'language',
	// The design the fan chose for each virtual ticket: JSON { [ticketId]:
	// preset } (see ticket-preset-storage.ts). Kept on this device only and
	// cleared on sign-out.
	ticketPresets: 'tickets.presets',
} as const

/**
 * Keys stored in `sessionStorage` rather than `localStorage` — these are
 * scoped to the current browser tab and cleared on tab close. Per-tab
 * scoping is intentional: cross-tab coordination is not needed for these
 * flags, and the looser bound (one event per tab per session) is the
 * desired behavior.
 */
export const SessionKeys = {
	// Set after the follow-reconcile task runs in the current tab so the
	// receipt-keyed reconcile fires at most once per tab. Cleared again if the
	// reconcile defers (no user id yet) so the next start retries. Per-tab
	// scoping is acceptable because the backend Follow/SetHype calls are
	// idempotent and the receipt makes queue-level migration exactly-once.
	followReconcileAttempted: 'follow.reconcileAttempted',
} as const

// Per-account guest-merge receipt. Written once a follow migration completes
// for an account; its PRESENCE — not the presence of guest follow data —
// decides whether boot reconciliation re-migrates. This makes follow migration
// exactly-once per account and prevents resurrecting state the user reverted
// after sign-up (migrate-then-clear-failed → reboot would otherwise re-follow).
export function guestMergedReceiptKey(userId: string): string {
	return `${GUEST_MERGED_RECEIPT_PREFIX}${userId}`
}

// Shared prefix for the per-account guest-merge receipt keys. The receipt's
// lifetime is ONE authenticated session: it prevents resurrecting reverted
// state WITHIN a session, but on sign-out every receipt is removed (by prefix,
// since the signed-out user's id is already cleared from in-memory + cached
// state by then) so a fresh post-sign-out guest session can migrate again.
export const GUEST_MERGED_RECEIPT_PREFIX = 'guestMerged:'
