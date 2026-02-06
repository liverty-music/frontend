# Design: Implement Frontend Authentication

## Context

The Liverty Music frontend is built with Aurelia 2. We need to integrate with the centralized identity provider (Zitadel) which is already provisioned via Pulumi in the `cloud-provisioning` repo. The infrastructure enforces a strict passwordless (Passkey) login policy. We need to implement the OIDC client side of this flow.

## Goals / Non-Goals

**Goals:**

- Enable users to sign up and sign in using Passkeys via Zitadel Hosted UI.
- Securely handle tokens using OIDC authorization code flow with PKCE.
- Maintain user session state in the Aurelia application.
- Provide a clear "Login / Register" entry point in the UI.

**Non-Goals:**

- Implementing custom login/registration forms (Hosted UI is authorized).
- Managing user roles or permissions granuarly (out of scope for initial auth).
- Implementing password-based login (explicitly disabled by policy).

## Decisions

### 1. Library Selection: `oidc-client-ts`

**Decision:** We will use `oidc-client-ts` instead of writing a custom OIDC wrapper or usage legacy `oidc-client`.
**Rationale:**

- It is the de-facto standard for modern TypeScript-based OIDC clients.
- It has native support for PKCE, which is required for our security model ("NONE" auth method type).
- It abstracts the complexity of token exchange, refresh, and session monitoring.
  **Alternatives Considered:**
- _Auth0 SPA JS_: Too vendor-specific.
- _Custom implementation_: High security risk and maintenance burden.

### 2. Architecture: DI-managed AuthService (Interface/Token)

**Decision:** Encapsulate all auth logic in an `AuthService` implementation registered with a global `IAuthService` DI token.
**Rationale:**

- Provides a single source of truth for authentication state (`isAuthenticated`, `user`).
- Decouples UI components from the underlying OIDC library via an interface.
- Follows Aurelia 2 best practices for testability and dependency injection.
- Ensures all consumers use `resolve(IAuthService)` instead of direct imports.

### 4. Observability: Structured Logging

**Decision:** Integrate Aurelia's `ILogger` into the authentication flow.
**Rationale:**
- Provides visibility into the OIDC state transitions and callback processing.
- Scoped loggers (`AuthService`, `AuthStatus`, etc.) simplify debugging of the redirect-heavy flow.
- Replaces unmanaged `console.log` calls with configurable sinks.

### 3. Callback Handling: Dedicated Component

**Decision:** Use a dedicated `AuthCallback` component mapped to `/auth/callback` to handle the redirect.
**Rationale:**

- Keeps the login flow separate from the main application view logic.
- Ensures a clear "loading/verifying" state can be shown while code exchange happens.
- Matches the redirect URI configured in the Zitadel application.

## Risks / Trade-offs

- **Risk:** **Passkey Adoption**: Users might be unfamiliar with Passkeys.
  - _Mitigation_: The Hosted UI provides guidance. This is a business/platform decision we are implementing.
- **Risk:** **Token Storage**: `oidc-client-ts` defaults to `sessionStorage` or `localStorage`.
  - _Mitigation_: For SPAs, this is standard trade-off. We rely on short-lived access tokens and refresh tokens.
- **Risk:** **Configuration Mismatch**: Client ID or Issuer URL mismatch.
  - _Mitigation_: Validation in `AuthService` initialization to error fast if env vars are missing.

## Migration Plan

NA - New feature.

## Open Questions

- Post-login redirect logic: currently defaults to Home, but deep-linking support should be considered for future.
