import { createConnectTransport } from '@connectrpc/connect-web'

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

export const transport = createConnectTransport({
	baseUrl,
})
