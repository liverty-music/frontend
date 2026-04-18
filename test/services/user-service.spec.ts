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

function makeAuth() {
	const auth = createMockAuth({
		isAuthenticated: true,
		user: { profile: { sub: externalID } } as never,
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
		it('returns undefined and skips Get when no user_id is cached', async () => {
			const svc = build({ storage, rpc })

			const result = await svc.ensureLoaded()

			expect(result).toBeUndefined()
			expect(rpc.get).not.toHaveBeenCalled()
		})

		it('calls Get with cached user_id and writes the result back to cache', async () => {
			storage.map.set(cacheKey, internalID)
			rpc.get.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			const result = await svc.ensureLoaded()

			expect(rpc.get).toHaveBeenCalledWith(internalID)
			expect(result).toBe(stubUser)
			expect(storage.impl.setItem).toHaveBeenCalledWith(cacheKey, internalID)
		})

		it('returns the in-memory cached user without re-issuing Get on subsequent calls', async () => {
			storage.map.set(cacheKey, internalID)
			rpc.get.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			await svc.ensureLoaded()
			const second = await svc.ensureLoaded()

			expect(rpc.get).toHaveBeenCalledTimes(1)
			expect(second).toBe(stubUser)
		})
	})

	describe('create', () => {
		it('writes the returned user_id to localStorage on success', async () => {
			rpc.create.mockResolvedValue(stubUser)
			const svc = build({ storage, rpc })

			const result = await svc.create('u@test.com')

			expect(result).toBe(stubUser)
			expect(storage.impl.setItem).toHaveBeenCalledWith(cacheKey, internalID)
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

			await svc.create('u@test.com')
			storage.map.delete(cacheKey)

			await svc.updateHome({ countryCode: 'JP', level1: 'JP-13' })

			expect(rpc.updateHome).toHaveBeenCalledWith(internalID, {
				countryCode: 'JP',
				level1: 'JP-13',
			})
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

			await svc.ensureLoaded()
			expect(svc.current).toBe(stubUser)

			svc.clear()

			expect(svc.current).toBeUndefined()
			expect(storage.impl.removeItem).toHaveBeenCalledWith(cacheKey)
		})
	})
})
