/**
 * Re-export shim. The runtime `/config.json` loader physically lives in the
 * top-level `shared/` directory — the single cross-app import surface shared
 * by the consumer (`src/`) and admin (`admin/`) entries (see OpenSpec change
 * `add-admin-console`, design D2/D3). Consumer modules keep importing from
 * this path unchanged; `shared/` remains a leaf.
 */
export {
	__resetAppConfigForTests,
	type AppConfig,
	getAppConfig,
	IAppConfig,
	KNOWN_HOSTS,
	loadAppConfig,
	validateEnvironmentMatchesHost,
} from '../../shared/config/app-config'
