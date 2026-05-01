/**
 * Curated list of entity stems permitted under the i18n `entity.*` namespace.
 *
 * Each stem corresponds to a protobuf entity defined in the specification repo
 * (`liverty-music/specification:proto/liverty_music/entity/v1/`). The stem is
 * derived from the entity name per the brand-vocabulary spec mirroring rule:
 *
 *   - `HypeLevel` (enum, drops the `Level` suffix) → `hype`
 *   - `Concert`   (message)                        → `concert`
 *   - `Artist`    (message)                        → `artist`
 *   - `User.HomeArea` (nested concept)             → `homeArea`
 *
 * When a new protobuf entity needs a UI label, add its stem here in the same
 * change that introduces the label. The brand-vocabulary lint script exits
 * non-zero if an `entity.<unknown>` key appears.
 */
export const KNOWN_ENTITY_STEMS: ReadonlySet<string> = new Set([
	'hype',
	'concert',
	'artist',
	'homeArea',
	'user',
	'venue',
	'event',
])
