import { CircularProgress } from '../../shared/ui/circular-progress/circular-progress'
import { ActionBar } from './action-bar/action-bar'
import { ConfirmDialog } from './confirm-dialog/confirm-dialog'
import { ConsoleButton } from './console-button/console-button'
import { ConsoleField } from './console-field/console-field'
import { ConsoleIcon } from './console-icon/console-icon'
import { ConsoleSnackbar } from './console-snackbar/console-snackbar'
import { ConsoleTabs } from './console-tabs/console-tabs'
import { CopyField } from './copy-field/copy-field'
import { DataList } from './data-list/data-list'
import { DescriptionList } from './description-list/description-list'
import { IconButton } from './icon-button/icon-button'
import { PrerequisiteCallout } from './prerequisite-callout/prerequisite-callout'
import { StatTile } from './stat-tile/stat-tile'
import { StatusBadge } from './status-badge/status-badge'
import { UnsavedChanges } from './unsaved-changes/unsaved-changes'
import { VenueField } from './venue-field/venue-field'

/** The console's components, registered once for every screen. */
export const ConsoleUi = [
	ActionBar,
	CircularProgress,
	ConfirmDialog,
	ConsoleButton,
	ConsoleField,
	ConsoleIcon,
	ConsoleSnackbar,
	ConsoleTabs,
	CopyField,
	DataList,
	DescriptionList,
	IconButton,
	PrerequisiteCallout,
	StatTile,
	StatusBadge,
	UnsavedChanges,
	VenueField,
]
