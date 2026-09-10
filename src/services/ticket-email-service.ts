import { DI, resolve } from 'aurelia'
import {
	ITicketEmailRpcClient,
	type TicketEmailCorrections,
} from '../adapter/rpc/client/ticket-email-client'
import type { TicketEmail, TicketEmailType } from '../entities/ticket-email'

export const ITicketEmailService = DI.createInterface<ITicketEmailService>(
	'ITicketEmailService',
	(x) => x.singleton(TicketEmailServiceClient),
)

export interface ITicketEmailService extends TicketEmailServiceClient {}

/**
 * Legacy alias kept for the route's existing import; the canonical type is
 * `TicketEmailType` in `entities/ticket-email`.
 */
export type EmailType = TicketEmailType

/** User corrections applied to a previously created ticket email. */
export type UpdateCorrections = TicketEmailCorrections

/**
 * Thin application-service facade over {@link ITicketEmailRpcClient}. Delegates to
 * the RPC adapter and exposes domain `TicketEmail` entities; it no longer imports
 * any generated (`@buf/*`) type, keeping the adapter boundary clean.
 */
export class TicketEmailServiceClient {
	private readonly client = resolve(ITicketEmailRpcClient)

	public create(
		rawBody: string,
		emailType: EmailType,
		eventIds: string[],
		signal?: AbortSignal,
	): Promise<TicketEmail[]> {
		return this.client.create(rawBody, emailType, eventIds, signal)
	}

	public update(
		ticketEmailId: string,
		corrections: UpdateCorrections,
		signal?: AbortSignal,
	): Promise<TicketEmail | undefined> {
		return this.client.update(ticketEmailId, corrections, signal)
	}
}
