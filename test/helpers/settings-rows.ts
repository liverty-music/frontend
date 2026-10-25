import { SettingsConsentRow } from '../../src/components/settings-consent-row/settings-consent-row'
import { SettingsLinkRow } from '../../src/components/settings-link-row/settings-link-row'
import { SettingsStatusRow } from '../../src/components/settings-status-row/settings-status-row'
import { SettingsSwitchRow } from '../../src/components/settings-switch-row/settings-switch-row'

/** The row components the Settings route is built from (globally registered in main.ts). */
export const SETTINGS_ROWS = [
	SettingsConsentRow,
	SettingsLinkRow,
	SettingsStatusRow,
	SettingsSwitchRow,
] as const
