# User Authentication

## ADDED Requirements

### Requirement: Sign Up / Sign In

The system SHALL provide a mechanism for users to authenticate via the Zitadel Hosted UI using OIDC.

#### Scenario: Initiate Login

- **WHEN** user clicks the "Sign In" or "Sign Up" button
- **THEN** the system redirects the user to the configured Zitadel Issuer URL
- **AND** the request includes the correct Client ID and PKCE challenge

#### Scenario: Handle Login Callback

- **WHEN** the user is redirected back to `/auth/callback` after successful authentication
- **THEN** the system exchanges the authorization code for ID/Access tokens
- **AND** updates the application state to "Authenticated"
- **AND** redirects the user to the home page (or strict post-login route)

### Requirement: Session Management

The system SHALL maintain the user's authentication state across page reloads and handle token expiration.

#### Scenario: Restore Session

- **WHEN** the application is loaded
- **THEN** the system checks for valid existing tokens
- **AND** if valid, restores the authenticated user session without requiring re-login

#### Scenario: Auto Sign-in (Silent Refresh)

- **WHEN** the access token is about to expire
- **THEN** the system attempts to renew the token silently using the Refresh Token

### Requirement: Sign Out

The system SHALL allow the user to terminate their session.

#### Scenario: Logout

- **WHEN** the user clicks "Sign Out"
- **THEN** the system clears local tokens
- **AND** redirects the user to the identity provider's end-session endpoint to clear the SSO session
