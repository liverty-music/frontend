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
import { AdminShell } from './admin-shell/admin-shell'
import { AdminAuthHook } from './hooks/auth-hook'

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
			<h1 style="font-size:1.5rem;margin:0 0 1rem">Admin console failed to start</h1>
			<p>The console could not initialize. Please try reloading the page.</p>
			${detail}
		</main>
	`.trim()
	console.error('Admin bootstrap failure:', err)
}

/**
 * Admin console bootstrap. Deliberately minimal — it reuses the SAME runtime
 * `/config.json` contract and the SAME OIDC `AuthService` as the consumer SPA
 * (both moved to `shared/`), but registers NO consumer-only services and NO
 * i18n machinery. The admin pod mounts its own `/config.json` carrying the
 * admin org id + admin client id at the canonical path, so the shared
 * `AuthService` automatically scopes sign-in to the admin org via the
 * `urn:zitadel:iam:org:id:<id>` scope (design D1/D4).
 *
 * No service worker is registered here: the admin entry ships no SW and is
 * excluded from the PWA precache manifest (design "Risks" — PWA scoping).
 */
async function bootstrap(): Promise<void> {
	const config = await loadAppConfig()
	validateEnvironmentMatchesHost(config)

	// Fail closed if the admin OIDC client id was not provisioned. The
	// cloud-provisioning admin ConfigMap ships a `PENDING_PULUMI_UP_…`
	// placeholder until `pulumi up` creates the admin app and the value is
	// filled from `pulumi stack output adminConsoleClientId`. The shared
	// validator only rejects empty strings, so without this guard the SPA would
	// boot and only fail opaquely at the Zitadel redirect with `invalid_client`.
	// Surfacing it here points the operator at the ConfigMap, not the IdP.
	if (config.zitadelClientId.startsWith('PENDING_')) {
		throw new Error(
			`Admin OIDC client id is not provisioned (got "${config.zitadelClientId}"). ` +
				'Fill admin-app-runtime-config from `pulumi stack output adminConsoleClientId` after provisioning.',
		)
	}

	const au = new Aurelia()

	// AppConfig first so AuthService (constructed during start) can resolve it.
	au.register(Registration.instance(IAppConfig, config))
	au.register(RouterConfiguration)
	au.register(
		LoggerConfiguration.create({
			level: resolveLogLevel(config.logLevel),
			sinks: [ConsoleSink],
		}),
	)
	au.register(IAuthService)
	// Registered globally so it runs as a shared `canLoad` guard on every route.
	au.register(AdminAuthHook)

	au.app(AdminShell)
	await au.start()

	removeBootstrapLoadingIndicator()
}

bootstrap().catch(showStaticErrorPage)
