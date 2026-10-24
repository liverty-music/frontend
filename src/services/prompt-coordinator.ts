import { DI, observable } from 'aurelia'

export const IPromptCoordinator = DI.createInterface<IPromptCoordinator>(
	'IPromptCoordinator',
	(x) => x.singleton(PromptCoordinator),
)

export interface IPromptCoordinator extends PromptCoordinator {}

export class PromptCoordinator {
	// Reactive signal so bottom-anchored passive UI (the pwa-install-banner)
	// suppresses itself while a post-signup surface occupies the same space (D7).
	// Spans the whole post-signup sequence — the celebration overlay AND the
	// PostSignupDialog that follows it — set by the dashboard route and the
	// dialog; read by app-shell.
	@observable public isPostSignupSurfaceOpen = false
}
