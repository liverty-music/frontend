import { createConnectTransport } from '@connectrpc/connect-web'
import type { AppConfig } from '../../shared/config/app-config'

/**
 * Creates a Connect transport targeting the CONSUMER API host (`apiBaseUrl`)
 * for calling PUBLIC consumer procedures from the admin console.
 *
 * The admin `AssociateArtist` flow needs to look up an existing artist by name,
 * but there is no admin artist-search RPC. `ArtistService.Search` (a public,
 * unauthenticated consumer procedure) already does exactly this. Rather than
 * import the consumer `src/` transport — which the bundle-isolation rule forbids
 * (admin may only cross into `shared/`) — this admin-local factory builds a
 * bare transport to the consumer server.
 *
 * Deliberately minimal: it targets `apiBaseUrl` (NOT `adminApiBaseUrl`, because
 * Search is served by the consumer server, not the admin server) and carries NO
 * auth interceptor, since the procedure is public. It therefore never reads or
 * transmits the admin operator's token to the consumer host.
 *
 * @param config - Resolved runtime AppConfig providing `apiBaseUrl`
 * @returns A configured Connect transport pointed at the consumer API host
 */
export const createConsumerPublicTransport = (config: AppConfig) =>
	createConnectTransport({ baseUrl: config.apiBaseUrl })
