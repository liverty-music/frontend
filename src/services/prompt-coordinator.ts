import { DI, observable } from 'aurelia'

export type PromptType = 'notification' | 'pwa-install'

export const IPromptCoordinator = DI.createInterface<IPromptCoordinator>(
	'IPromptCoordinator',
	(x) => x.singleton(PromptCoordinator),
)

export interface IPromptCoordinator extends PromptCoordinator {}

export class PromptCoordinator {
	private shownPromptType: PromptType | null = null

	// Reactive signal so bottom-anchored passive UI (the pwa-install-banner)
	// suppresses itself while a post-signup surface occupies the same space (D7).
	// Spans the whole post-signup sequence — the celebration overlay AND the
	// PostSignupDialog that follows it — set by the dashboard route and the
	// dialog; read by app-shell.
	@observable public isPostSignupSurfaceOpen = false

	public canShowPrompt(_type: PromptType): boolean {
		return this.shownPromptType === null
	}

	public markShown(type: PromptType): void {
		this.shownPromptType = type
	}
}
