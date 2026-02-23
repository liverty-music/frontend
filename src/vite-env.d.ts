/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_BASE_URL: string
	readonly VITE_ZITADEL_ISSUER: string
	readonly VITE_ZITADEL_CLIENT_ID: string
	readonly VITE_ZITADEL_ORG_ID: string
	readonly VITE_CIRCUIT_BASE_URL: string
	readonly VITE_VAPID_PUBLIC_KEY: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
