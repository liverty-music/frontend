import { Code, ConnectError } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IUserRpcClient } from '../../src/adapter/rpc/client/user-client'
import { ILocalStorage } from '../../src/adapter/storage/local-storage'
import type { User } from '../../src/entities/user'
import { IAuthService } from '../../src/services/auth-service'
import {
	IUserService,
	UserServiceClient,
} from '../../src/services/user-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

const externalID = 'ext-abc'
const internalID = 'user-uuid-1'
const cacheKey = `liverty:userId:${externalID}`
const userEmail = 'u@test.com'

function makeAuth(opts?: { email?: string | null }) {
	const profile: { sub: string; email?: string } = { sub: externalID }
	if (opts?.email !== null) {
		profile.email = opts?.email ?? userEmail
	}
	const auth = createMockAuth({
		isAuthenticated: true,
		user: { profile } as never,
	})
	return auth
}

function makeStorage() {
	const map = new Map<string, string>()
	return {
		map,
		impl: {
			getItem: vi.fn((k: string) => map.get(k) ?? null),
			setItem: vi.fn((k: string, v: string) => {
				map.set(k, v)
			}),
			removeItem: vi.fn((k: string) => {
				map.delete(k)
			}),
		},
	}
}

function makeRpcClient() {
	return {
		get: vi.fn(),
		create: vi.fn(),
		updateHome: vi.fn(),
		updatePreferredLanguage: vi.fn(),
		resendEmailVerification: vi.fn(),
	}
}

function build(opts: {
	storage: ReturnType<typeof makeStorage>
	rpc: ReturnType<typeof makeRpcClient>
	auth?: Partial<IAuthService>
}) {
	const auth = opts.auth ?? makeAuth()
	const container = createTestContainer(
		Registration.instance(IAuthService, auth as IAuthService),
		Registration.instance(IUserRpcClient, opts.rpc as never),
		Registration.instance(ILocalStorage, opts.storage.impl as never),
	)
	container.register(Registration.singleton(IUserService, UserServiceClient))
	return container.get(IUserService)
}

const stubUser: User = {
	id: internalID,
	externalId: externalID,
	email: 'u@test.com',
	name: 'U',
} as User

describe('UserServiceClient', () => {
	let storage: ReturnType<typeof makeStorage>
	let rpc: ReturnType<typeof makeRpcClient>

	beforeEach(() => {
		storage = makeStorage()
		rpc = makeRpcClient()
	})

	describe('ensureLoaded', () => {
		it('falls back to idempotent Create when no user_id is cached and reports created=true', async () => {
			rpc.create.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			const result = await svc.ensureLoaded('ja')

			expect(rpc.get).not.toHaveBeenCalled()
			expect(rpc.create).toHaveBeenCalledWith(userEmail, 'ja')
			expect(result.user).toBe(stubUser)
			// No cached user_id → reached Create on the new-account path.
			expect(result.created).toBe(true)
			expect(storage.impl.setItem).toHaveBeenCalledWith(cacheKey, internalID)
		})

		it('returns undefined user (created=false) when no cache AND no email in JWT claims', async () => {
			const svc = build({
				storage,
				rpc,
				auth: makeAuth({ email: null }),
			})

			const result = await svc.ensureLoaded('ja')

			expect(result.user).toBeUndefined()
			expect(result.created).toBe(false)
			expect(rpc.get).not.toHaveBeenCalled()
			expect(rpc.create).not.toHaveBeenCalled()
		})

		it('calls Get with cached user_id, writes back to cache, and reports created=false', async () => {
			storage.map.set(cacheKey, internalID)
			rpc.get.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			const result = await svc.ensureLoaded('ja')

			expect(rpc.get).toHaveBeenCalledWith(internalID)
			expect(rpc.create).not.toHaveBeenCalled()
			expect(result.user).toBe(stubUser)
			// Cache hit → returning account, not new.
			expect(result.created).toBe(false)
			expect(storage.impl.setItem).toHaveBeenCalledWith(cacheKey, internalID)
		})

		it('returns the in-memory cached user (created=false) without re-issuing Get on subsequent calls', async () => {
			storage.map.set(cacheKey, internalID)
			rpc.get.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			await svc.ensureLoaded('ja')
			const second = await svc.ensureLoaded('ja')

			expect(rpc.get).toHaveBeenCalledTimes(1)
			expect(second.user).toBe(stubUser)
			expect(second.created).toBe(false)
		})

		it('self-heals when cached user_id is rejected with PermissionDenied — clears cache and recovers via Create', async () => {
			storage.map.set(cacheKey, 'stale-uuid')
			rpc.get.mockRejectedValue(
				new ConnectError('user_id mismatch', Code.PermissionDenied),
			)
			rpc.create.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			const result = await svc.ensureLoaded('ja')

			expect(rpc.get).toHaveBeenCalledWith('stale-uuid')
			expect(storage.impl.removeItem).toHaveBeenCalledWith(cacheKey)
			expect(rpc.create).toHaveBeenCalledWith(userEmail, 'ja')
			expect(result.user).toBe(stubUser)
			// New userId should be cached after Create succeeds
			expect(storage.impl.setItem).toHaveBeenCalledWith(cacheKey, internalID)
		})

		it('rethrows non-PermissionDenied errors from Get without clearing cache', async () => {
			storage.map.set(cacheKey, internalID)
			rpc.get.mockRejectedValue(new ConnectError('not found', Code.NotFound))
			const svc = build({ storage, rpc })

			await expect(svc.ensureLoaded('ja')).rejects.toThrow(/not found/)
			expect(storage.impl.removeItem).not.toHaveBeenCalled()
			expect(rpc.create).not.toHaveBeenCalled()
		})
	})

	describe('create', () => {
		it('writes the returned user_id to localStorage and reports created=true for a fresh-cache identity', async () => {
			rpc.create.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			const result = await svc.create('u@test.com', 'ja')

			expect(result.user).toBe(stubUser)
			// No cached user_id before the call → genuinely new account.
			expect(result.created).toBe(true)
			expect(rpc.create).toHaveBeenCalledWith('u@test.com', 'ja', undefined)
			expect(storage.impl.setItem).toHaveBeenCalledWith(cacheKey, internalID)
		})

		it('reports created=false when a user_id is already cached (returning identity tapping Sign up)', async () => {
			// A returning user already has a cached user_id; the idempotent backend
			// returns their existing row, so this is NOT a new account.
			storage.map.set(cacheKey, internalID)
			rpc.create.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			const result = await svc.create('u@test.com', 'ja')

			expect(result.user).toBe(stubUser)
			expect(result.created).toBe(false)
		})
	})

	describe('updateHome', () => {
		it('reads cached user_id, calls RPC, and writes back', async () => {
			storage.map.set(cacheKey, internalID)
			rpc.updateHome.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			await svc.updateHome({ countryCode: 'JP', level1: 'JP-13' })

			expect(rpc.updateHome).toHaveBeenCalledWith(internalID, {
				countryCode: 'JP',
				level1: 'JP-13',
			})
		})

		it('throws when no user_id is cached and no in-memory current exists', async () => {
			const svc = build({ storage, rpc })

			await expect(
				svc.updateHome({ countryCode: 'JP', level1: 'JP-13' }),
			).rejects.toThrow(/user_id is not available/)
			expect(rpc.updateHome).not.toHaveBeenCalled()
		})

		it('uses in-memory user_id when cache is missing but a previous Create has run', async () => {
			rpc.create.mockResolvedValue(stubUser)
			rpc.updateHome.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			await svc.create('u@test.com', 'ja')
			storage.map.delete(cacheKey)

			await svc.updateHome({ countryCode: 'JP', level1: 'JP-13' })

			expect(rpc.updateHome).toHaveBeenCalledWith(internalID, {
				countryCode: 'JP',
				level1: 'JP-13',
			})
		})

		it('patches _current.home locally when the RPC returns an empty payload', async () => {
			// Mirrors the updatePreferredLanguage empty-payload test: the
			// settings UI reads userService.current.home immediately after
			// the RPC resolves. If the backend omits the user field (valid
			// proto3 default), wiping _current with undefined would clear
			// the rest of the session's profile (id, preferredLanguage)
			// and break requireUserId guards on subsequent calls. The
			// write-through patch must preserve everything except home.
			storage.map.set(cacheKey, internalID)
			rpc.get.mockResolvedValue(stubUser)
			rpc.updateHome.mockResolvedValue(undefined)
			const svc = build({ storage, rpc })
			await svc.ensureLoaded('ja')

			const result = await svc.updateHome({
				countryCode: 'JP',
				level1: 'JP-13',
			})

			expect(result?.home?.level1).toBe('JP-13')
			expect(result?.home?.countryCode).toBe('JP')
			// Other fields preserved (didn't wipe _current).
			expect(svc.current?.id).toBe(internalID)
		})
	})

	describe('updatePreferredLanguage', () => {
		it('replaces _current with the populated User the RPC returns', async () => {
			storage.map.set(cacheKey, internalID)
			const updated = { ...stubUser, preferredLanguage: 'en' } as User
			rpc.updatePreferredLanguage.mockResolvedValue(updated)
			const svc = build({ storage, rpc })
			// Hydrate _current first so we have something to compare against.
			rpc.get.mockResolvedValue(stubUser)
			await svc.ensureLoaded('ja')

			const result = await svc.updatePreferredLanguage('en')

			expect(rpc.updatePreferredLanguage).toHaveBeenCalledWith(internalID, 'en')
			expect(result).toBe(updated)
			expect(svc.current).toBe(updated)
			expect(svc.current?.preferredLanguage).toBe('en')
		})

		it('patches _current.preferredLanguage locally when the RPC returns an empty payload', async () => {
			// Load-bearing path: the settings UI reads
			// `userService.current.preferredLanguage` immediately after the
			// RPC resolves. If the backend omits the user field (valid
			// proto3 default), we must still surface the just-sent value
			// from the in-memory cache rather than leave the stale one.
			storage.map.set(cacheKey, internalID)
			rpc.updatePreferredLanguage.mockResolvedValue(undefined)
			const svc = build({ storage, rpc })
			rpc.get.mockResolvedValue(stubUser)
			await svc.ensureLoaded('ja')
			const before = svc.current
			expect(before?.preferredLanguage).toBeUndefined()

			const result = await svc.updatePreferredLanguage('en')

			expect(rpc.updatePreferredLanguage).toHaveBeenCalledWith(internalID, 'en')
			expect(result?.preferredLanguage).toBe('en')
			expect(svc.current?.preferredLanguage).toBe('en')
			// Other fields preserved (didn't wipe _current).
			expect(svc.current?.id).toBe(internalID)
		})

		it('throws when no user_id is available', async () => {
			const svc = build({ storage, rpc })

			await expect(svc.updatePreferredLanguage('en')).rejects.toThrow(
				/user_id is not available/,
			)
			expect(rpc.updatePreferredLanguage).not.toHaveBeenCalled()
		})
	})

	describe('resendEmailVerification', () => {
		it('reads cached user_id and forwards it to the RPC client', async () => {
			storage.map.set(cacheKey, internalID)
			rpc.resendEmailVerification.mockResolvedValue(undefined)
			const svc = build({ storage, rpc })

			await svc.resendEmailVerification()

			expect(rpc.resendEmailVerification).toHaveBeenCalledWith(internalID)
		})

		it('throws when no user_id is available', async () => {
			const svc = build({ storage, rpc })

			await expect(svc.resendEmailVerification()).rejects.toThrow(
				/user_id is not available/,
			)
		})
	})

	describe('clear', () => {
		it('removes the cached user_id and forgets the in-memory current', async () => {
			storage.map.set(cacheKey, internalID)
			rpc.get.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			await svc.ensureLoaded('ja')
			expect(svc.current).toBe(stubUser)

			svc.clear()

			expect(svc.current).toBeUndefined()
			expect(storage.impl.removeItem).toHaveBeenCalledWith(cacheKey)
		})
	})
})
