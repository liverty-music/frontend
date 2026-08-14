import './styles/main.css'
import { RouterConfiguration } from '@aurelia/router'
import Aurelia, {
	ConsoleSink,
	LoggerConfiguration,
	LogLevel,
	Registration,
} from 'aurelia'
import {
	type AppConfig,
	IAppConfig,
	loadAppConfig,
	validateEnvironmentMatchesHost,
} from '../shared/config/app-config'
import { IAuthService } from '../shared/services/auth-service'
import { OrganizerAuthHook } from './hooks/auth-hook'
import { OrganizerShell } from './organizer-shell/organizer-shell'
import { resolveOrgId } from './services/org-handle'

function resolveLogLevel(configLogLevel: AppConfig['logLevel']): LogLevel {
	const map: Record<AppConfig['logLevel'], LogLevel> = {
		trace: LogLevel.trace,
		debug: LogLevel.debug,
		info: LogLevel.info,
		warn: LogLevel.warn,
		error: LogLevel.error,
	}
	return map[configLogLevel]
}

function removeBootstrapLoadingIndicator(): void {
	document.getElementById('bootstrap-loading')?.remove()
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function showStaticErrorPage(err: unknown): void {
	const message = err instanceof Error ? err.message : String(err)
	const detail = import.meta.env.DEV ? `<pre>${escapeHtml(message)}</pre>` : ''
	document.body.innerHTML = `
		<main style="font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem;color:#222">
			<h1 style="font-size:1.5rem;margin:0 0 1rem">Organizer console failed to start</h1>
			<p>The console could not initialize. Please try reloading the page.</p>
			${detail}
		</main>
	`.trim()
	console.error('Organizer bootstrap failure:', err)
}

/**
 * Organizer console bootstrap. Reuses the SAME runtime `/config.json` contract
 * and the SAME OIDC `AuthService` as the consumer/admin entries (all in
 * `shared/`), but registers NO consumer-only services and NO i18n machinery.
 *
 * Unlike the admin entry, the organizer `/config.json` carries NO fixed org id
 * (one client serves all tenants — design D1). The tenant org is pinned per
 * session by an **org handle** resolved here (URL `org_id`/`org`, or a
 * remembered id) and injected into the config as `zitadelOrgId`, so the shared
 * `AuthService` scopes sign-in to that tenant via `urn:zitadel:iam:org:id:<id>`.
 * A fresh device with no handle signs in unpinned; the owner-role route guard
 * still gates access.
 *
 * No service worker is registered here: the organizer entry ships no SW and is
 * excluded from the PWA precache manifest (mirrors the admin entry).
 */
async function bootstrap(): Promise<void> {
	// The organizer config omits `zitadelOrgId` by contract; load without
	// requiring it, then pin the org from the resolved handle below.
	const config = await loadAppConfig({ requireOrgId: false })
	validateEnvironmentMatchesHost(config)

	// Fail closed if the organizer OIDC client id was not provisioned. The
	// cloud-provisioning organizer ConfigMap ships a `PENDING_PULUMI_UP_…`
	// placeholder until `pulumi up` creates the organizer app and the value is
	// filled from `pulumi stack output organizerConsoleClientId`. Surfacing it
	// here points the operator at the ConfigMap, not the IdP `invalid_client`.
	if (config.zitadelClientId.startsWith('PENDING_')) {
		throw new Error(
			`Organizer OIDC client id is not provisioned (got "${config.zitadelClientId}"). ` +
				'Fill organizer-app-runtime-config from `pulumi stack output organizerConsoleClientId` after provisioning.',
		)
	}

	// Org-pinned entry: resolve the tenant org from the URL handle or a
	// remembered id and fold it into the config the shared AuthService reads.
	// When no handle is present the org stays unset — sign-in proceeds unpinned.
	const orgId = resolveOrgId(window.location.search, window.localStorage)
	const effectiveConfig: AppConfig = orgId
		? { ...config, zitadelOrgId: orgId }
		: config

	const au = new Aurelia()

	// AppConfig first so AuthService (constructed during start) can resolve it.
	au.register(Registration.instance(IAppConfig, effectiveConfig))
	au.register(RouterConfiguration)
	au.register(
		LoggerConfiguration.create({
			level: resolveLogLevel(effectiveConfig.logLevel),
			sinks: [ConsoleSink],
		}),
	)
	au.register(IAuthService)
	// Registered globally so it runs as a shared `canLoad` guard on every route.
	au.register(OrganizerAuthHook)

	au.app(OrganizerShell)
	await au.start()

	removeBootstrapLoadingIndicator()
}

bootstrap().catch(showStaticErrorPage)
