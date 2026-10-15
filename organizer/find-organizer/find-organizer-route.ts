import { ILogger, resolve } from 'aurelia'
import { EMAIL_MAX_LENGTH, emailProblem } from '../../shared/utils/email'
import { Code, ConnectError } from '../services/connect-error-copy'
import { IOrganizerClient } from '../services/organizer-client'
import type { FieldErrorText } from '../ui/console-field/console-field'

/** What the screen says after a send. */
export type FindOrganizerOutcome = 'none' | 'sent' | 'tooMany' | 'failed'

/**
 * The find-organizer screen (design D4): opened by the route guard when the
 * console knows no Organization, neither from its address nor remembered on
 * the device. It asks for the email the visitor uses for their Organizer and
 * calls `OrganizerService.SendSignInLinks`, which needs no sign-in. The answer
 * is the same for every address, so the screen never says whether the address
 * runs an Organizer, and it shows no Organizer, Organization or sign-in form.
 * Each emailed link opens `/?org=<short name>`, which signs in to that
 * Organizer's Organization and remembers it on the device.
 */
export class FindOrganizerRoute {
	private readonly client = resolve(IOrganizerClient)
	private readonly logger = resolve(ILogger).scopeTo('FindOrganizerRoute')

	public email = ''
	public emailError: FieldErrorText = null
	public outcome: FindOrganizerOutcome = 'none'

	public async send(): Promise<void> {
		this.outcome = 'none'
		const email = this.email.trim()
		this.emailError = emailErrorOf(email)
		if (this.emailError) return
		try {
			await this.client.sendSignInLinks(email)
			this.outcome = 'sent'
		} catch (err) {
			if (err instanceof ConnectError) {
				if (err.code === Code.ResourceExhausted) {
					this.outcome = 'tooMany'
					return
				}
				if (err.code === Code.InvalidArgument) {
					this.emailError = 'findOrganizer.emailInvalid'
					return
				}
			}
			this.logger.warn('Sign-in links could not be requested', err)
			this.outcome = 'failed'
		}
	}
}

/** The field error for a trimmed email, or null when it can be sent. */
function emailErrorOf(email: string): FieldErrorText {
	switch (emailProblem(email)) {
		case 'empty':
			return 'findOrganizer.emailRequired'
		case 'invalid':
			return 'findOrganizer.emailInvalid'
		case 'tooLong':
			return {
				key: 'findOrganizer.emailTooLong',
				params: { max: EMAIL_MAX_LENGTH },
			}
		default:
			return null
	}
}
