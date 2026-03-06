import { DI } from 'aurelia'

export type PromptType = 'notification' | 'pwa-install'

export const IPromptCoordinator = DI.createInterface<IPromptCoordinator>(
	'IPromptCoordinator',
	(x) => x.singleton(PromptCoordinator),
)

export interface IPromptCoordinator extends PromptCoordinator {}

export class PromptCoordinator {
	private shownPromptType: PromptType | null = null

	public canShowPrompt(_type: PromptType): boolean {
		return this.shownPromptType === null
	}

	public markShown(type: PromptType): void {
		this.shownPromptType = type
	}
}
