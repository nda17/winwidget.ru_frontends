import { getPublicHttpClient } from '@/shared/api/http-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshSession } from './refresh-session'

vi.mock('@/shared/api/http-client', () => ({
	getPublicHttpClient: vi.fn()
}))

const post = vi.fn()
const mockedGetPublicHttpClient = vi.mocked(getPublicHttpClient)

describe('refreshSession', () => {
	beforeEach(() => {
		mockedGetPublicHttpClient.mockReturnValue({ post } as never)
	})

	it('keeps only the minimal authenticated session fields', async () => {
		post.mockResolvedValue({
			data: {
				accessToken: 'access-token',
				user: {
					id: 'user-1',
					email: 'private@example.test'
				}
			}
		})

		await expect(refreshSession()).resolves.toEqual({
			accessToken: 'access-token',
			userId: 'user-1'
		})
		expect(post).toHaveBeenCalledWith('/auth/refresh')
	})

	it('classifies only HTTP 401 as an anonymous session', async () => {
		post.mockRejectedValue({
			isAxiosError: true,
			response: { status: 401 }
		})

		await expect(refreshSession()).rejects.toMatchObject({
			kind: 'anonymous'
		})
	})

	it.each([
		{ isAxiosError: true, response: { status: 403 } },
		{ isAxiosError: true, response: { status: 500 } },
		{ isAxiosError: true, response: { status: 503 } },
		{ isAxiosError: true, code: 'ECONNABORTED' },
		{ isAxiosError: true }
	])('classifies non-401 failures as temporary', async error => {
		post.mockRejectedValue(error)

		await expect(refreshSession()).rejects.toMatchObject({
			kind: 'temporary'
		})
	})

	it('fails closed on an invalid response', async () => {
		post.mockResolvedValue({ data: { accessToken: 'access-token' } })

		await expect(refreshSession()).rejects.toMatchObject({
			kind: 'temporary'
		})
	})
})
