/**
 * Re-export shim. The OIDC `AuthService` physically lives in the top-level
 * `shared/` directory — the single cross-app import surface shared by the
 * consumer (`src/`) and admin (`admin/`) entries (see OpenSpec change
 * `add-admin-console`, design D2/D3). Consumer modules keep importing from
 * this path unchanged; `shared/` remains a leaf (it imports neither `src/`
 * nor `admin/`).
 */
export {
	AuthService,
	IAuthService,
} from '../../shared/services/auth-service'
