/**
 * Re-export shim. The well-known-hosts map physically lives in `shared/`
 * (see OpenSpec change `add-admin-console`, design D2/D3). Consumer modules,
 * Playwright specs, and build scripts keep importing from this path unchanged.
 */
export {
	KNOWN_HOSTS,
	type KnownEnvironment,
} from '../../shared/config/known-hosts'
