import { I18N } from '@aurelia/i18n'
import { bindable, INode, resolve } from 'aurelia'
import { artistHue } from '../../../adapter/view/artist-color'
import { toDomesticDisplay } from '../../../lib/to-e164'
import { currentLanguage } from '../../../util/change-locale'
import {
	type EventPageEvent,
	formatEventDate,
	formatEventTime,
	prefectureLabel,
} from '../../event/event-page'
import type { WalletPersonalDetails, WalletTicket } from '../wallet-view'
import { STAMP_ANIMATION } from './admission-stamp'

/** Dispatched on the host when the stamp's pressing animation has played to its end. */
export const STAMP_PRESSED = 'stamp-pressed'

let nextId = 0

/**
 * The face of one ticket as a collectible: the event's cover image, its
 * performers and title, the date, the venue and its prefecture, the open and
 * start times, the seat type, that no seat is assigned, the eligible person's
 * full name and phone number, and the resale notice. Every item is text, so
 * it can be selected and is read by a screen reader.
 *
 * A ticket that is 入場済み carries the admission stamp: 入場済 and the admit
 * time. With `pressStamp` the stamp is pressed onto the face (about 1.5 s)
 * and the host then dispatches `stamp-pressed`; without it, or when the fan
 * has asked to reduce motion, the stamp is shown at rest and nothing is
 * dispatched.
 *
 * The face holds no QR code and no ticket id. `data-share` on the face (or on
 * a clone of it) masks the full name and phone number, hides the stamp and
 * leaves the cover's area empty; the share image is made from that.
 */
export class VirtualTicket {
	/** The ticket's event; null when its details could not be read. */
	@bindable public event: EventPageEvent | null = null
	@bindable public ticket: WalletTicket | null = null
	@bindable public personalDetails: WalletPersonalDetails | null = null
	/** Press the stamp with its animation rather than show it at rest. */
	@bindable public pressStamp = false

	private readonly i18n = resolve(I18N)
	private readonly host = resolve(INode) as HTMLElement

	public readonly titleId = `virtual-ticket-title-${++nextId}`

	/** Bound via `ref`: the face, the element the share image is made from. */
	public face?: HTMLElement
	/** Bound via `ref`: the cover image, drawn into the share image. */
	public coverImage?: HTMLImageElement

	/** The cover image failed to load (no connection, or gone). */
	public coverFailed = false

	public eventChanged(): void {
		this.coverFailed = false
	}

	public get showsCover(): boolean {
		return !!this.event?.coverUrl && !this.coverFailed
	}

	public onCoverError(): void {
		this.coverFailed = true
	}

	/** The hue of the face's lower part: the first performer's, as on the event cards. */
	public get hue(): number {
		const first = this.event?.performers[0]?.name
		return first ? artistHue(first) : 0
	}

	public get performers(): string {
		return (this.event?.performers ?? []).map((p) => p.name).join(' / ')
	}

	private get lang(): string {
		return currentLanguage(this.i18n)
	}

	public get date(): string {
		return this.event ? formatEventDate(this.event, this.lang) : ''
	}

	public get prefecture(): string {
		return this.event ? prefectureLabel(this.event, this.lang) : ''
	}

	public time(value: Date | undefined): string {
		return value ? formatEventTime(value) : ''
	}

	public get phoneNumber(): string {
		const phone = this.personalDetails?.phoneNumber
		return phone ? toDomesticDisplay(phone) : ''
	}

	public get entered(): boolean {
		return this.ticket?.state === 'entered'
	}

	/** The admit time as month/day and time in Japan time, e.g. "11/20 18:32". */
	public get admitTime(): string {
		const at = this.ticket?.admitTime
		if (!at) return ''
		return new Intl.DateTimeFormat(this.lang, {
			timeZone: 'Asia/Tokyo',
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		}).format(at)
	}

	public get admitIso(): string {
		return this.ticket?.admitTime?.toISOString() ?? ''
	}

	/**
	 * Whether the stamp is being pressed: asked for, on an entered ticket, and
	 * the fan has not asked the device to reduce motion.
	 */
	public get pressing(): boolean {
		return this.pressStamp && this.entered && !reducedMotion()
	}

	public onStampAnimationEnd(event: AnimationEvent): void {
		if (event.animationName !== STAMP_ANIMATION || !this.pressing) return
		this.host.dispatchEvent(
			new CustomEvent(STAMP_PRESSED, {
				bubbles: true,
				detail: { ticketId: this.ticket?.id ?? '' },
			}),
		)
	}
}

function reducedMotion(): boolean {
	return (
		typeof matchMedia === 'function' &&
		matchMedia('(prefers-reduced-motion: reduce)').matches
	)
}
