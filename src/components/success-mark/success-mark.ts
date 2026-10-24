/**
 * The mark of a finished action (e.g. a verified email address): a ring and
 * a check that draw themselves, then settle with one short pulse. It answers
 * the fan's tap, so it plays once, when it appears. It is decorative: the
 * message beside it says what happened.
 *
 * With reduced motion the M3 duration tokens are 0 ms, so the finished mark
 * shows at once.
 */
export class SuccessMark {}
