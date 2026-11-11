import { ListItem } from '../../src/components/list-item/list-item'
import { SettingsConsentRow } from '../../src/components/settings-consent-row/settings-consent-row'
import { SettingsStatusRow } from '../../src/components/settings-status-row/settings-status-row'
import { SettingsSwitchRow } from '../../src/components/settings-switch-row/settings-switch-row'

/** The row components the Settings route is built from (globally registered in main.ts). */
export const SETTINGS_ROWS = [
	SettingsConsentRow,
	ListItem,
	SettingsStatusRow,
	SettingsSwitchRow,
] as const
