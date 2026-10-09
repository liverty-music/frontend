import './styles/main.css'
import { RouterConfiguration } from '@aurelia/router'
import Aurelia, {
	ConsoleSink,
	LoggerConfiguration,
	LogLevel,
	Registration,
} from 'aurelia'
import {
	IReceptionConfig,
	loadReceptionConfig,
	type ReceptionConfig,
} from './config/reception-config'
import { ReceptionShell } from './reception-shell/reception-shell'

function resolveLogLevel(level: ReceptionConfig['logLevel']): LogLevel {
	const map: Record<ReceptionConfig['logLevel'], LogLevel> = {
		trace: LogLevel.trace,
		debug: LogLevel.debug,
		info: LogLevel.info,
		warn: LogLevel.warn,
		error: LogLevel.error,
	}
	return map[level]
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
		<main lang="ja" style="font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem;color:#222">
			<h1 style="font-size:1.5rem;margin:0 0 1rem">受付画面を開けませんでした</h1>
			<p>ページを再読み込みしてください。</p>
			${detail}
		</main>
	`.trim()
	console.error('Reception bootstrap failure:', err)
}

/**
 * Reception app bootstrap: venue staff open a reception link on their phone.
 * It loads its own `/config.json` (environment, reception API base URL, log
 * level) and registers no OIDC client, no sign-in and no service worker, so it
 * cannot read or use console tokens even by mistake. It is served from its own
 * origin (`reception.<domain>`), separate from the console's browser storage.
 * See OpenSpec change `isolate-venue-reception`, design D4.
 */
async function bootstrap(): Promise<void> {
	const config = await loadReceptionConfig()

	const au = new Aurelia()
	au.register(Registration.instance(IReceptionConfig, config))
	au.register(RouterConfiguration)
	au.register(
		LoggerConfiguration.create({
			level: resolveLogLevel(config.logLevel),
			sinks: [ConsoleSink],
		}),
	)

	au.app(ReceptionShell)
	await au.start()

	removeBootstrapLoadingIndicator()
}

bootstrap().catch(showStaticErrorPage)
