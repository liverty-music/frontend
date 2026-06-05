/**
 * Re-export shim. `SignedOut` physically lives in `shared/` because the
 * shared `AuthService` publishes it on sign-out (see OpenSpec change
 * `add-admin-console`, design D2/D3). Consumer modules keep importing from
 * this path unchanged.
 */
export { SignedOut } from '../../../shared/services/events/signed-out'
