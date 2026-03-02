## ADDED Requirements

### Requirement: Canvas replenishes bubbles when similar artists are exhausted
When a user follows an artist and the similar-artist API returns no new (unseen) artists, the system SHALL automatically fetch replacement bubbles from the top-artist pool to keep the canvas populated.

#### Scenario: Similar artists fully deduplicated
- **WHEN** user taps a bubble AND `getSimilarArtists()` returns zero new bubbles after deduplication
- **THEN** the system SHALL call `loadReplacementBubbles()` to fetch fresh artists from the top-artist pool
- **AND** any unseen artists SHALL be spawned as new bubbles near the absorption point

#### Scenario: Top artist pool also exhausted
- **WHEN** user taps a bubble AND both similar artists and replacement bubbles return zero new artists
- **THEN** the system SHALL gracefully accept an empty canvas without errors
- **AND** the complete button (if visible) SHALL remain functional

#### Scenario: Replacement bubbles partially available
- **WHEN** user taps a bubble AND similar artists are exhausted but 5 of 50 top artists are unseen
- **THEN** the system SHALL spawn only the 5 unseen artists as new bubbles
- **AND** the previously seen artists SHALL NOT reappear on the canvas
