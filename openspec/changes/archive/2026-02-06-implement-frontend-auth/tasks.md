# Tasks: Implement Frontend Authentication

## 1. Setup & Configuration

- [x] 1.1 Install `oidc-client-ts` dependency
- [x] 1.2 Update `vite-env.d.ts` (if needed) and create `.env` / `.env.development` with `VITE_ZITADEL_ISSUER` and `VITE_ZITADEL_CLIENT_ID` placeholders/values

## 2. Core Service Implementation

- [x] 2.1 Create `src/services/auth-service.ts`
- [x] 2.2 Implement `UserManager` initialization with PKCE settings
- [x] 2.3 Implement `signIn`, `signOut`, `register` methods
- [x] 2.4 Implement `handleCallback` method
- [x] 2.5 Expose reactive user state (`isAuthenticated`, user profile)
- [x] 2.6 Refactor `AuthService` to use DI Interface/Token approach
- [x] 2.7 Introduce structured logging using `ILogger`

## 3. UI Components

- [x] 3.1 Create `src/routes/auth-callback.ts` and `src/routes/auth-callback.html`
- [x] 3.2 Implement callback logic (trigger service, handle success/error redirect)
- [x] 3.3 Create `src/components/auth-status.ts` and `src/components/auth-status.html`
- [x] 3.4 Implement "Sign In" / "Sign Up" / "Log Out" buttons and user avatar display

## 4. Integration

- [x] 4.1 Register `AuthService` in the dependency injection container
- [x] 4.2 Update `src/my-app.ts` (routing) to include `auth/callback` route
- [x] 4.3 Add `AuthStatus` component to the main layout

## 5. Verification

- [x] 5.1 Run unit tests for `AuthService` (mocking oidc-client-ts)
- [x] 5.2 Manual Verification: Perform full Sign In / Sign Out flow with Zitadel


