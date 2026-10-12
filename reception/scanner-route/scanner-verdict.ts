import { bindable } from 'aurelia'
import type { Verdict } from './verdict'

/**
 * One scan's verdict on the scanner screen: OK with the head count, or NG
 * (or not decided) with each reason and the next step, in large type and in
 * both colour and text. A pure function of its `verdict`; it never receives
 * personal data.
 */
export class ScannerVerdict {
	@bindable public verdict: Verdict | null = null
}
