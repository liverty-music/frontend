## ADDED Requirements

### Requirement: Followed count reflects localStorage state
The `LocalArtistClient.followedCount` property SHALL be an `@observable` that is updated whenever `follow()`, `unfollow()`, or `clearAll()` is called, so that Aurelia bindings re-evaluate immediately.

#### Scenario: Initial page load with existing guest data
- **WHEN** the user navigates to `/onboarding/discover` and `localStorage['guest.followedArtists']` contains 3 artists
- **THEN** the counter SHALL display `3/3` and the complete button SHALL be visible

#### Scenario: Follow an artist during onboarding
- **WHEN** the user taps a bubble to follow an artist
- **THEN** the counter SHALL increment by 1 within the same frame (e.g., `0/3` → `1/3`)
- **AND** the progress bar fill width SHALL update accordingly

#### Scenario: Unfollow an artist
- **WHEN** the user unfollows a previously followed artist
- **THEN** the counter SHALL decrement by 1 immediately

### Requirement: Persistent guidance until first interaction
The onboarding guidance message SHALL remain visible until the user taps their first bubble. The 5-second auto-dismiss timer SHALL be removed.

#### Scenario: Page load without prior interactions
- **WHEN** the user arrives at the discovery page for the first time (followedCount = 0)
- **THEN** the guidance message "好きなアーティストを3組タップしよう！" SHALL be displayed
- **AND** the message SHALL NOT auto-dismiss after any timeout

#### Scenario: First bubble tap dismisses guidance
- **WHEN** the user taps their first bubble
- **THEN** the guidance message SHALL fade out (400ms transition)
- **AND** a progress-specific message SHALL appear in its place

### Requirement: Staged progress messages
The system SHALL display contextual progress messages that change as the user follows more artists.

#### Scenario: After following 1 artist
- **WHEN** followedCount becomes 1
- **THEN** the guidance area SHALL display "いいね！あと2組！"

#### Scenario: After following 2 artists
- **WHEN** followedCount becomes 2
- **THEN** the guidance area SHALL display "あと1組！"

#### Scenario: After following 3 or more artists
- **WHEN** followedCount reaches 3 (TUTORIAL_FOLLOW_TARGET)
- **THEN** the guidance area SHALL display "準備完了！"
- **AND** the complete button SHALL become visible and visually highlighted

### Requirement: Orb pulse on follow
The central Music DNA orb SHALL pulse each time an artist is followed, providing visual feedback that the selection was registered.

#### Scenario: Bubble tap triggers orb pulse
- **WHEN** a bubble is tapped and the follow operation succeeds
- **THEN** the `DnaOrbCanvas.followedCountChanged` callback SHALL fire
- **AND** the orb SHALL play a pulse animation
