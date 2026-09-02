import { DI } from 'aurelia'
import type { VerificationMethod } from '../../entities/verified-identity'

/**
 * Vendor seam for the Pocket Sign (PocketSign Verify) card-read SDK.
 *
 * The real card read — physical マイナンバーカード over NFC (+PIN) and the
 * スマホJPKI phone-embedded credential — is performed by the Pocket Sign Verify
 * JS SDK inside our app: it takes the backend-issued challenge (Nonce), reads
 * and signs it against the card, and returns the signed response for
 * `CompleteVerify` to validate through the Verify API.
 *
 * The SDK is NOT available until Pocket Sign onboarding completes (加盟契約 +
 * sandbox — identity-ekyc-jpki Section 0). We therefore model the read behind
 * this interface so the service and UI can be built, tested, and shipped now,
 * and the real SDK slots in behind the interface later with no call-site
 * changes.
 */
export interface IPocketSignVerifyClient {
	/**
	 * Whether the Pocket Sign Verify SDK is available in this build/runtime. The
	 * stub reports `false` so the UI can surface a friendly "coming soon" state
	 * instead of starting a flow that cannot complete.
	 */
	readonly isAvailable: boolean

	/**
	 * Read the card and produce the signed response for the given challenge.
	 * @param method Which credential to read (JPKI card/スマホJPKI or the licence fallback).
	 * @param challenge The backend-issued Nonce to sign (opaque; passed to the SDK verbatim).
	 * @returns The SDK-produced signed response to submit to `CompleteVerify`.
	 * @throws PocketSignUnavailableError when the SDK is not yet integrated.
	 */
	readCard(
		method: VerificationMethod,
		challenge: Uint8Array,
	): Promise<Uint8Array>
}

/**
 * Thrown by the stub (and by a future real client on an unusable runtime) when
 * the Pocket Sign Verify SDK cannot perform a card read. The service catches it
 * and reports a `vendorUnavailable` outcome so the UI shows the "coming soon"
 * message rather than a hard error.
 */
export class PocketSignUnavailableError extends Error {
	public constructor(message = 'Pocket Sign Verify SDK is not yet available') {
		super(message)
		this.name = 'PocketSignUnavailableError'
	}
}

export const IPocketSignVerifyClient =
	DI.createInterface<IPocketSignVerifyClient>('IPocketSignVerifyClient', (x) =>
		x.singleton(StubPocketSignVerifyClient),
	)

/**
 * Stub implementation used until Pocket Sign onboarding (Section 0) delivers the
 * Verify SDK. It reports `isAvailable === false` and rejects any card read.
 *
 * TODO: integrate Pocket Sign Verify SDK card-read after onboarding
 * (identity-ekyc-jpki Section 0). Replace this class with a real client that
 * loads the Verify SDK and performs the physical-NFC / スマホJPKI read, and
 * register it in `main.ts` in place of the stub.
 */
export class StubPocketSignVerifyClient implements IPocketSignVerifyClient {
	public readonly isAvailable = false

	public async readCard(
		_method: VerificationMethod,
		_challenge: Uint8Array,
	): Promise<Uint8Array> {
		// TODO: integrate Pocket Sign Verify SDK card-read after onboarding
		// (identity-ekyc-jpki Section 0).
		throw new PocketSignUnavailableError()
	}
}
