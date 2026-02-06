# Proposal: Implement Frontend Authentication

## Why

The Liverty Music platform requires a secure and seamless authentication mechanism. Our infrastructure already enforces a modern, passwordless (Passkey-only) login policy using Zitadel. The frontend needs to implement the client-side logic to interface with this system, ensuring users can securely sign up and sign in without the friction and security risks of passwords.

## What Changes

We will implement OIDC with PKCE (Proof Key for Code Exchange) using the `oidc-client-ts` library, which is the standard for securing Single Page Applications (SPAs).

- **Add Dependency**: Install `oidc-client-ts` for robust OIDC/OAuth2 support.
- **New Service**: Create `AuthService` to manage the `oidc-client-ts` `UserManager`, handling login, logout, and token management.
- **New Route**: Add `/auth/callback` to handle the OIDC redirect and code exchange.
- **UI Updates**:
  - Add `LoginStatus` component to user's authentication state and provide Sign In/Sign Out buttons.
  - Integrate authentication checks into the main application layout.
- **Environment Config**: Add support for `VITE_ZITADEL_ISSUER` and `VITE_ZITADEL_CLIENT_ID` environment variables.

## Capabilities

### New Capabilities

- `user-auth`: Capabilities for user identity management, including OIDC client configuration, session management, and UI integration.

### Modified Capabilities

- _(None)_
