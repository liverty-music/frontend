/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_BASE_URL: string
	readonly VITE_ZITADEL_ISSUER: string
	readonly VITE_ZITADEL_CLIENT_ID: string
	readonly VITE_ZITADEL_ORG_ID: string
	readonly VITE_CIRCUIT_BASE_URL: string
	readonly VITE_VAPID_PUBLIC_KEY: string
	/**
	 * Local-dev only: set in a gitignored `.env.local` to point the Vite proxy
	 * at a local backend. Its presence also opts into the gitignored
	 * `public/config.local.json` runtime override (see `app-config.ts`).
	 */
	readonly VITE_DEV_API_TARGET?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
