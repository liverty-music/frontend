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
import { ConsoleI18nConfiguration } from './i18n/console-language'
import { ConsoleFormatters } from './i18n/converters'
import { OrganizerShell } from './organizer-shell/organizer-shell'
import { ILoginHint, readLoginHintFromSearch } from './services/login-hint'
import { applyOrgPin, resolveOrgPin } from './services/org-handle'
import { ConsoleContextHook } from './shell/console-context-hook'
import { ConsoleUi } from './ui'
import { ConsoleShadowStyles } from './ui/shadow-styles'

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
		<main style="font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem">
			<h1 style="font-size:1.5rem;margin:0 0 1rem">コンソールを開けませんでした</h1>
			<p>ページを再読み込みしてください。</p>
			<p lang="en">The console could not start. Please reload the page.</p>
			${detail}
		</main>
	`.trim()
	console.error('Organizer bootstrap failure:', err)
}

/**
 * Organizer console bootstrap. Reuses the SAME runtime `/config.json` contract
 * and the SAME OIDC `AuthService` as the consumer/admin entries (all in
 * `shared/`), but registers NO consumer-only services. The console has its own
 * Japanese and English catalogs (`organizer/locales`).
 *
 * Unlike the admin entry, the organizer `/config.json` carries NO fixed org id
 * (one client serves all tenants — design D1). The Organizer's Organization is
 * named per session by an **org pin** resolved here (`?org_id=<id>`,
 * `?org=<short name>`, or the pin remembered on the device) and folded into
 * the config, so the shared `AuthService` scopes sign-in to that Organization
 * (`services/org-handle.ts`). A device with no pin never signs in: the route
 * guard opens the find-organizer screen instead (design D4 of
 * `reuse-fan-email-for-organizer-sign-in`).
 *
 * No service worker is registered here: the organizer entry ships no SW and is
 * excluded from the PWA precache manifest (mirrors the admin entry).
 */
async function bootstrap(): Promise<void> {
	// The organizer config omits `zitadelOrgId` by contract; load without
	// requiring it, then pin the org from the resolved handle below. It must
	// carry `receptionBaseUrl`: Scanner link URLs are built on that origin.
	const config = await loadAppConfig({
		requireOrgId: false,
		requireReceptionBaseUrl: true,
	})
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

	// Org-pinned entry: resolve the Organization from the address or the device
	// and fold it into the config the shared AuthService reads. Without one the
	// Organization stays unset and the route guard opens find-organizer.
	const effectiveConfig: AppConfig = applyOrgPin(
		config,
		resolveOrgPin(window.location.search, window.localStorage),
	)

	// login_hint pre-fill (design D5): present on first sign-in only, embedded
	// in the invitation link as ?login_hint=<email> by the provisioning backend.
	// Passed to AuthService.signIn() via the auth hook so Zitadel pre-fills the
	// email field, skipping one manual input step for the operator.
	const loginHint = readLoginHintFromSearch(window.location.search)

	const au = new Aurelia()

	// AppConfig first so AuthService (constructed during start) can resolve it.
	au.register(Registration.instance(IAppConfig, effectiveConfig))
	au.register(Registration.instance(ILoginHint, loginHint))
	au.register(
		ConsoleI18nConfiguration,
		ConsoleShadowStyles,
		...ConsoleFormatters,
		...ConsoleUi,
	)
	// The shell sets the document title itself (`<page> — Organizer Console`,
	// design D20), from the page's breadcrumb in the language shown.
	au.register(RouterConfiguration.customize({ buildTitle: () => null }))
	au.register(
		LoggerConfiguration.create({
			level: resolveLogLevel(effectiveConfig.logLevel),
			sinks: [ConsoleSink],
		}),
	)
	au.register(IAuthService)
	// Registered globally so they run on every route, in this order: the auth
	// hook admits an owner, then the context hook checks the address's
	// Organizer and follows its Artist (design D1).
	au.register(OrganizerAuthHook, ConsoleContextHook)

	au.app(OrganizerShell)
	await au.start()

	removeBootstrapLoadingIndicator()
}

bootstrap().catch(showStaticErrorPage)
