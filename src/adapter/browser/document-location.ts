import { DI } from 'aurelia'

/** Full-page navigation away from the app (e.g. to the hosted login). */
export interface IDocumentLocation {
	assign(url: string): void
}

export const IDocumentLocation = DI.createInterface<IDocumentLocation>(
	'IDocumentLocation',
	(x) =>
		x.instance({
			assign: (url: string) => window.location.assign(url),
		}),
)
