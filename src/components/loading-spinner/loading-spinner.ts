import { bindable } from 'aurelia'

export class LoadingSpinner {
	@bindable public size: 'sm' | 'md' | 'lg' = 'md'
}
