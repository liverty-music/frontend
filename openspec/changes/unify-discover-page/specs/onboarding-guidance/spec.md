## CHANGED Requirements

### Requirement: Onboarding guidance rendered within unified DiscoverPage
The onboarding guidance HUD (progress dots, guidance message, CTA button) SHALL be rendered as a conditional section within `DiscoverPage` at `/discover`, instead of in a separate `ArtistDiscoveryPage` at `/onboarding/discover`.

#### Scenario: Onboarding user navigates to discover
- **WHEN** `OnboardingService.isOnboarding` is `true` and the user navigates to `/discover`
- **THEN** the onboarding HUD (progress dots + guidance message) SHALL be visible
- **AND** the search bar and genre filter SHALL also be available

#### Scenario: Normal user navigates to discover
- **WHEN** `OnboardingService.isOnboarding` is `false` and the user navigates to `/discover`
- **THEN** the onboarding HUD SHALL NOT be rendered
- **AND** no CTA button SHALL be shown (bottom navigation provides transitions)

#### Scenario: CTA button visibility during onboarding
- **WHEN** `OnboardingService.isOnboarding` is `true` and `followedCount >= 3`
- **THEN** the CTA button "ダッシュボードを生成する" SHALL be visible
- **AND** tapping it SHALL navigate to `onboarding/loading`

### Requirement: Search and genre filter available during onboarding
The search bar and genre filter chips SHALL be visible and functional during onboarding, allowing users to find specific artists they already know.

#### Scenario: Onboarding user searches for an artist
- **WHEN** the user is in onboarding mode and types a query into the search bar
- **THEN** search results SHALL appear and the user SHALL be able to follow artists from the results
- **AND** the follow operation SHALL use the same unified flow (localStorage during onboarding)
