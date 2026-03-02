## MODIFIED Requirements

### Requirement: Complete button is tappable on all devices
The complete button ("ダッシュボードを生成する") SHALL be tappable on both desktop and mobile devices. The canvas element SHALL NOT intercept pointer events in the button's area.

#### Scenario: Mobile tap on complete button
- **WHEN** user taps the complete button on a mobile device
- **THEN** the `onViewSchedule()` handler SHALL fire
- **AND** the user SHALL be navigated to the loading sequence

#### Scenario: Desktop click on complete button
- **WHEN** user clicks the complete button on desktop
- **THEN** the `onViewSchedule()` handler SHALL fire

### Requirement: No z-index stacking in discovery page CSS
The artist discovery page SHALL NOT use `z-index` for visual stacking. All layer ordering SHALL be achieved through DOM source order, following the web-app-specialist skill's CSS standards.

#### Scenario: Overlay elements paint above canvas
- **WHEN** the discovery page renders
- **THEN** the onboarding HUD, orb label, and complete button SHALL paint above the canvas
- **AND** no CSS `z-index` property SHALL be present in `artist-discovery-page.css`

#### Scenario: Starfield pseudo-element paints behind content
- **WHEN** the discovery page renders
- **THEN** the `.container::before` starfield SHALL paint behind all content elements
- **AND** the starfield SHALL use `pointer-events: none` without `z-index`
