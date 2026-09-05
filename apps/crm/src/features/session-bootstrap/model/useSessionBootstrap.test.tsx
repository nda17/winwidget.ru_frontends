import { resetSessionStore } from '@/entities/session'
import {
	refreshSession,
	SessionBootstrapError
} from '@/features/session-bootstrap/api/refresh-session'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessionBootstrap } from './useSessionBootstrap'

vi.mock('@/features/session-bootstrap/api/refresh-session', async () => {
	const actual = await vi.importActual<
		typeof import('@/features/session-bootstrap/api/refresh-session')
	>('@/features/session-bootstrap/api/refresh-session')

	return {
		...actual,
		refreshSession: vi.fn()
	}
})

const mockedRefreshSession = vi.mocked(refreshSession)

const StrictModeWrapper = ({ children }: PropsWithChildren) => (
	<StrictMode>{children}</StrictMode>
)

describe('useSessionBootstrap', () => {
	beforeEach(() => {
		resetSessionStore()
	})

	afterEach(() => {
		cleanup()
	})

	it('deduplicates the refresh request under Strict Mode', async () => {
		mockedRefreshSession.mockResolvedValue({
			accessToken: 'access-token',
			userId: 'user-1'
		})

		const { result } = renderHook(() => useSessionBootstrap(), {
			wrapper: StrictModeWrapper
		})

		await waitFor(() => {
			expect(result.current.status).toBe('authenticated')
		})
		expect(mockedRefreshSession).toHaveBeenCalledTimes(1)
	})

	it('marks HTTP 401 as anonymous', async () => {
		mockedRefreshSession.mockRejectedValue(
			new SessionBootstrapError('anonymous', 'Требуется вход')
		)

		const { result } = renderHook(() => useSessionBootstrap())

		await waitFor(() => {
			expect(result.current.status).toBe('anonymous')
		})
	})

	it('keeps temporary failures on a retryable error state', async () => {
		mockedRefreshSession.mockRejectedValue(
			new SessionBootstrapError('temporary', 'Временная ошибка')
		)

		const { result } = renderHook(() => useSessionBootstrap())

		await waitFor(() => {
			expect(result.current).toMatchObject({
				status: 'error',
				errorMessage: 'Временная ошибка'
			})
		})
	})

	it('recovers from a temporary outage on explicit retry without classifying it as logout', async () => {
		mockedRefreshSession
			.mockRejectedValueOnce(
				new SessionBootstrapError('temporary', 'Временная ошибка')
			)
			.mockResolvedValueOnce({
				accessToken: 'synthetic-access-token',
				userId: 'user-1'
			})
		const { result } = renderHook(() => useSessionBootstrap())
		await waitFor(() => expect(result.current.status).toBe('error'))
		expect(mockedRefreshSession).toHaveBeenCalledTimes(1)
		act(() => result.current.retry())
		await waitFor(() =>
			expect(result.current.status).toBe('authenticated')
		)
		expect(mockedRefreshSession).toHaveBeenCalledTimes(2)
		expect(result.current.errorMessage).toBeNull()
	})
})
