import { bindable, ILogger, resolve } from 'aurelia'
import { ISnackbar } from '../console-snackbar/snackbar'

/** How long the copy icon shows its check mark. */
export const COPIED_MS = 2000

/**
 * A value to hand on (a scanner link, a share link) with a copy button. Copying
 * turns the icon into a check mark for 2 s and reports コピーしました in the
 * snackbar, which screen readers announce.
 */
export class CopyField {
	private readonly snackbar = resolve(ISnackbar)
	private readonly logger = resolve(ILogger).scopeTo('CopyField')

	@bindable public label = ''
	@bindable public value = ''

	public copied = false
	private timer: ReturnType<typeof setTimeout> | null = null

	public async copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.value)
		} catch (err) {
			this.logger.warn('Clipboard write failed', err)
			this.snackbar.showError('copyField.failed')
			return
		}
		this.copied = true
		if (this.timer !== null) clearTimeout(this.timer)
		this.timer = setTimeout(() => {
			this.copied = false
			this.timer = null
		}, COPIED_MS)
		this.snackbar.show('common.copied')
	}

	public detaching(): void {
		if (this.timer !== null) clearTimeout(this.timer)
		this.timer = null
	}
}
