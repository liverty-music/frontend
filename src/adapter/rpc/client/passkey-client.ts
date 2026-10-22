import { PasskeyService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/passkey/v1/passkey_service_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { PasskeyRecord } from '../../../entities/passkey'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export const IPasskeyRpcClient = DI.createInterface<IPasskeyRpcClient>(
	'IPasskeyRpcClient',
	(x) => x.singleton(PasskeyRpcClient),
)

export interface IPasskeyRpcClient extends PasskeyRpcClient {}

/** `PasskeyService`: the platform's records of the fan's passkeys. */
export class PasskeyRpcClient {
	private readonly client = createClient(
		PasskeyService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		),
	)

	/** The signed-in fan's recorded passkeys, newest first. */
	public async list(): Promise<PasskeyRecord[]> {
		const resp = await this.client.list({})
		return resp.passkeys.flatMap((p) => {
			const id = p.id?.value
			if (!id) return []
			return [
				{
					id,
					...(p.providerName?.value
						? { providerName: p.providerName.value }
						: {}),
					...(p.createTime ? { createTime: timestampDate(p.createTime) } : {}),
				},
			]
		})
	}
}
