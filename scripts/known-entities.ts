/**
 * Curated list of entity stems permitted under the i18n `entity.*` namespace.
 *
 * Each stem corresponds to a protobuf entity defined in the specification repo
 * (`liverty-music/specification:proto/liverty_music/entity/v1/`). The stem is
 * derived from the entity name per the brand-vocabulary spec mirroring rule:
 *
 *   - `Concert`   (message)                        → `concert`
 *   - `Artist`    (message)                        → `artist`
 *   - `User.HomeArea` (nested concept)             → `homeArea`
 *
 * Note: `HypeType` (proto enum) does NOT appear here. The four hype tier surface
 * forms (`Watch / Home / Nearby / Away`) and the `Hype` concept label itself
 * are Layer B brand expressions per `openspec/specs/brand-vocabulary/spec.md`;
 * they are rendered invariantly in English and are not sourced from i18n.
 * Adding `hype` back to this set will cause `entity.hype.*` keys to pass the
 * known-entity check, which would silently re-introduce locale-translated
 * tier labels — exactly the drift the Layer B graduation eliminated.
 *
 * When a new protobuf entity needs a UI label, add its stem here in the same
 * change that introduces the label. The brand-vocabulary lint script exits
 * non-zero if an `entity.<unknown>` key appears.
 */
export const KNOWN_ENTITY_STEMS: ReadonlySet<string> = new Set([
	'concert',
	'artist',
	'homeArea',
	'user',
	'venue',
	'event',
])
