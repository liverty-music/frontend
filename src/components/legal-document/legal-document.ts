import { I18N } from '@aurelia/i18n'
import { bindable, resolve } from 'aurelia'

/**
 * A single section of a legal document: a heading followed by one or more
 * body paragraphs. The shape mirrors the `legal.<doc>.sections[]` entries in
 * `src/locales/{ja,en}/translation.json`, which i18next returns verbatim when
 * `tr` is called with `returnObjects: true`.
 */
export interface LegalSection {
	readonly heading: string
	readonly body: readonly string[]
}

/**
 * Renders a hand-authored legal document (Terms of Service or Privacy Policy)
 * from the i18n resource bundle. The same markup serves both documents — the
 * `docKey` bindable selects the `legal.<docKey>.*` key namespace.
 *
 * Content lives entirely in i18n so it follows the active locale via the
 * existing `@aurelia/i18n` mechanism. The static fields (title, intro, draft
 * banner, last-updated stamp) bind through the `t` attribute, which is signal-
 * reactive on locale change. The variable-length `sections` array has no `t`
 * equivalent, so it is read through a getter and re-evaluated on the i18n
 * signal (see the template's `& signal` binding behavior).
 *
 * The OSS Licenses page is intentionally NOT rendered here: its content is a
 * build-time generated artifact, not hand-authored i18n prose.
 */
export class LegalDocument {
	/** Selects which document's i18n namespace to render. */
	@bindable public docKey: 'terms' | 'privacy' = 'terms'

	private readonly i18n = resolve(I18N)

	/** i18n key for the document title, e.g. `legal.privacy.title`. */
	public get titleKey(): string {
		return `legal.${this.docKey}.title`
	}

	/** i18n key for the introductory paragraph. */
	public get introKey(): string {
		return `legal.${this.docKey}.intro`
	}

	/** i18n key for the "last updated" date stamp value. */
	public get lastUpdatedKey(): string {
		return `legal.${this.docKey}.lastUpdated`
	}

	/** Ordered sections for the active locale, read fresh on each evaluation. */
	public get sections(): readonly LegalSection[] {
		// i18next returns the raw array for `returnObjects`, but the `tr`
		// type signature is declared as `string`; cast through `unknown`.
		return this.i18n.tr(`legal.${this.docKey}.sections`, {
			returnObjects: true,
		}) as unknown as readonly LegalSection[]
	}
}
