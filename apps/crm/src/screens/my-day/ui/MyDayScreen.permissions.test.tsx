import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import type { CrmPermissions } from '@/entities/crm-access'
import { resetSessionStore, useSessionStore } from '@/entities/session'
import {
	getWorkdayTask,
	listWorkdayTasks,
	listWorkdayTimeline,
	mutateWorkdayTask
} from '@/entities/crm-workday/api/workday.api'
import {
	entry,
	membershipId,
	page,
	task,
	workspaceId
} from '@/entities/crm-workday/model/workday.test-fixtures'
import {
	authenticatedRequest,
	AuthenticatedApiError
} from '@/shared/api/authenticated-http-client'
import {
	commandOwner,
	PendingCommandProvider
} from '@/shared/lib/pending-command'
import MyDayScreen from './MyDayScreen'

let client: QueryClient
let permissions: CrmPermissions
const workspace = { workspaceId, canWrite: true }
// Deliberately keep the real permission hook AND its getter/parser. Mocking the
// getter's transport is necessary because the hook calls the module-local getter.
vi.mock('@/entities/crm-access', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-access')>(
		'@/entities/crm-access'
	)),
	useCrmWorkspaceAccess: () => workspace
}))
vi.mock('@/shared/api/authenticated-http-client', async () => ({
	...(await vi.importActual<
		typeof import('@/shared/api/authenticated-http-client')
	>('@/shared/api/authenticated-http-client')),
	authenticatedRequest: vi.fn()
}))
vi.mock('@/entities/crm-workday/api/workday.api', async () => ({
	...(await vi.importActual<
		typeof import('@/entities/crm-workday/api/workday.api')
	>('@/entities/crm-workday/api/workday.api')),
	getWorkdayTask: vi.fn(),
	listWorkdayTasks: vi.fn(),
	listWorkdayTimeline: vi.fn(),
	mutateWorkdayTask: vi.fn()
}))
vi.mock('@/entities/crm-team', async () => ({
	...(await vi.importActual<typeof import('@/entities/crm-team')>(
		'@/entities/crm-team'
	)),
	useAssigneeOptions: () => ({
		resolveBinding: () => ({
			subject: 'actor',
			membershipId,
			displayName: 'Иван',
			verifiedEmail: null,
			role: 'OWNER'
		}),
		loading: false
	}),
	useTeamOptions: () => ({ validSelection: true }),
	AssigneeSelect: () => null,
	TeamSelect: () => null
}))
vi.mock('./WorkdayPeopleFilters', () => ({
	WorkdayPeopleFilters: () => null
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const readOwner = () => {
	const state = useSessionStore.getState()
	return commandOwner(state.session?.userId, state.sessionRevision)
}
const Wrapper = ({ children }: PropsWithChildren) => {
	const state = useSessionStore()
	return (
		<QueryClientProvider client={client}>
			<PendingCommandProvider
				owner={commandOwner(state.session?.userId, state.sessionRevision)}
				readOwner={readOwner}
			>
				{children}
			</PendingCommandProvider>
		</QueryClientProvider>
	)
}
const deferred = <T,>() => {
	let resolve!: (value: T) => void
	let reject!: (error: Error) => void
	const promise = new Promise<T>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}
const titleField = () => screen.getByLabelText('Название задачи')
const openTask = async () => {
	fireEvent.click(await screen.findByRole('button', { name: task.title }))
	await waitFor(() => {
		expect(titleField()).toHaveProperty('disabled', false)
		expect(titleField().closest('[hidden]')).toBeNull()
	})
}
const startRefresh = async () => {
	const response = deferred<CrmPermissions>()
	vi.mocked(authenticatedRequest).mockReturnValueOnce(response.promise)
	let pending!: Promise<void>
	await act(async () => {
		pending = client.refetchQueries({ queryKey: ['crm-permissions'] })
		await Promise.resolve()
	})
	await waitFor(() =>
		expect(titleField()).toHaveProperty('disabled', true)
	)
	return { ...response, pending }
}
beforeEach(() => {
	vi.resetAllMocks()
	resetSessionStore()
	useSessionStore
		.getState()
		.setAuthenticated({ accessToken: 'token', userId: 'actor' })
	permissions = {
		schemaVersion: 1,
		workspaceId,
		subject: 'actor',
		role: 'OWNER',
		state: 'ACTIVE',
		dataScope: 'ALL',
		teamIds: [],
		permissions: ['sales:read', 'sales:write']
	}
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnWindowFocus: false }
		}
	})
	Object.defineProperties(HTMLDialogElement.prototype, {
		showModal: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = true
			}
		},
		close: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = false
			}
		}
	})
	vi.mocked(authenticatedRequest).mockImplementation(async request => {
		if (request.url !== '/crm/access/permissions')
			throw new Error(`Unexpected test request ${request.url}`)
		return permissions
	})
	vi.mocked(listWorkdayTasks).mockImplementation(
		async (_token, request) => ({
			...page,
			page: request.page,
			pageSize: request.pageSize,
			items:
				!request.status || request.status === task.status ? [task] : [],
			total: !request.status || request.status === task.status ? 1 : 0
		})
	)
	vi.mocked(getWorkdayTask).mockResolvedValue(task)
	vi.mocked(listWorkdayTimeline).mockImplementation(
		async (_token, request) => ({
			schemaVersion: 1,
			page: request.page,
			pageSize: request.pageSize,
			total: 1,
			items: [entry]
		})
	)
})
afterEach(() => {
	cleanup()
	client.clear()
	resetSessionStore()
})

describe('MyDay actual permission query lifecycle', () => {
	it('settles real stale permission observers without a collection mount/refetch loop', async () => {
		render(<MyDayScreen />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: task.title })
		await waitFor(() => expect(client.isFetching()).toBe(0))
		const calls = vi.mocked(authenticatedRequest).mock.calls.length
		expect(calls).toBeLessThan(12)
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 80))
		})
		expect(authenticatedRequest).toHaveBeenCalledTimes(calls)
		expect(screen.getByRole('button', { name: task.title })).toBeTruthy()
		expect(screen.getByText(/^Данные на /).textContent).toContain(
			'Europe/Moscow'
		)
		expect(screen.getByText(/^Данные на /).textContent).toContain(
			'Обновить'
		)
	})
	it.each(['list', 'board'] as const)(
		'recovers an existing task drawer command from %s after route navigation instead of allowing a competing quick command',
		async viewMode => {
			vi.mocked(mutateWorkdayTask).mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Unknown result')
			)
			vi.mocked(mutateWorkdayTask).mockResolvedValue({
				...task,
				title: 'Исходное сохранение',
				version: 2
			})
			const view = render(<MyDayScreen />, { wrapper: Wrapper })
			await openTask()
			fireEvent.change(titleField(), {
				target: { value: 'Исходное сохранение' }
			})
			fireEvent.click(
				screen.getByRole('button', { name: 'Сохранить название и срок' })
			)
			await screen.findByRole('button', { name: 'Проверить результат' })
			const original = vi.mocked(mutateWorkdayTask).mock.calls[0][1]
			view.rerender(<></>)
			view.rerender(<MyDayScreen />)
			await screen.findByRole('button', { name: task.title })
			if (viewMode === 'board')
				fireEvent.click(screen.getByRole('button', { name: 'Доска' }))
			const recover = await screen.findByRole('button', {
				name: 'Проверить сохранение'
			})
			const status = screen.getByLabelText(`Статус задачи «${task.title}»`)
			expect(status).toHaveProperty('disabled', true)
			fireEvent.change(status, { target: { value: 'IN_PROGRESS' } })
			expect(mutateWorkdayTask).toHaveBeenCalledTimes(1)
			if (viewMode === 'board')
				expect(
					screen.getByRole('button', {
						name: `Переместить задачу «${task.title}»`
					})
				).toHaveProperty('disabled', true)
			fireEvent.click(recover)
			fireEvent.click(
				await screen.findByRole('button', { name: 'Проверить результат' })
			)
			await waitFor(() =>
				expect(mutateWorkdayTask).toHaveBeenCalledTimes(2)
			)
			expect(vi.mocked(mutateWorkdayTask).mock.calls[1][1]).toBe(original)
		}
	)
	it('does not announce a view switch that an unresolved quick command refused', async () => {
		vi.mocked(mutateWorkdayTask).mockRejectedValue(
			new AuthenticatedApiError('temporary', 'Unknown result')
		)
		render(<MyDayScreen />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: task.title })
		fireEvent.change(
			screen.getByLabelText(`Статус задачи «${task.title}»`),
			{ target: { value: 'IN_PROGRESS' } }
		)
		await screen.findByRole('button', { name: 'Проверить сохранение' })
		vi.mocked(toast).mockClear()
		fireEvent.click(screen.getByRole('button', { name: 'Доска' }))
		expect(toast).not.toHaveBeenCalledWith('Доска задач')
		expect(
			screen.queryByRole('region', { name: 'Доска задач' })
		).toBeNull()
	})
	it('keeps a task editor mounted but concealed/inert during refresh, retaining its exact draft', async () => {
		render(<MyDayScreen />, { wrapper: Wrapper })
		await openTask()
		fireEvent.change(titleField(), {
			target: { value: 'Несохранённый результат встречи' }
		})
		const before = titleField()
		const response = await startRefresh()
		expect(titleField()).toBe(before)
		expect(titleField().closest('[hidden]')).not.toBeNull()
		expect(titleField().closest('[inert]')).not.toBeNull()
		expect(mutateWorkdayTask).not.toHaveBeenCalled()
		await act(async () => {
			response.resolve(permissions)
			await response.pending
		})
		await waitFor(() =>
			expect(titleField()).toHaveProperty('disabled', false)
		)
		expect(titleField()).toBe(before)
		expect(titleField()).toHaveProperty(
			'value',
			'Несохранённый результат встречи'
		)
		expect(titleField().closest('[hidden]')).toBeNull()
	})
	it('keeps a creation draft mounted through the real background permission refresh', async () => {
		render(<MyDayScreen />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: task.title })
		fireEvent.click(screen.getByRole('button', { name: 'Новая задача' }))
		await waitFor(() =>
			expect(titleField()).toHaveProperty('disabled', false)
		)
		fireEvent.change(titleField(), {
			target: { value: 'Черновик новой задачи' }
		})
		const before = titleField()
		const response = await startRefresh()
		expect(titleField()).toBe(before)
		await act(async () => {
			response.resolve(permissions)
			await response.pending
		})
		await waitFor(() =>
			expect(titleField()).toHaveProperty('disabled', false)
		)
		expect(titleField()).toHaveProperty('value', 'Черновик новой задачи')
	})
	it.each(['forbidden', 'unauthorized'] as const)(
		'discards private data after a real %s permission response',
		async kind => {
			render(<MyDayScreen />, { wrapper: Wrapper })
			await openTask()
			fireEvent.change(titleField(), {
				target: { value: 'Приватный черновик' }
			})
			const response = await startRefresh()
			await act(async () => {
				response.reject(new AuthenticatedApiError(kind, 'Access revoked'))
				await response.pending
			})
			await screen.findByText('Не удалось проверить права на задачи.')
			expect(screen.queryByLabelText('Название задачи')).toBeNull()
			expect(screen.queryByRole('button', { name: task.title })).toBeNull()
		}
	)
	it('does not carry a draft through a confirmed scope change to READ_ONLY', async () => {
		render(<MyDayScreen />, { wrapper: Wrapper })
		await openTask()
		fireEvent.change(titleField(), { target: { value: 'До смены прав' } })
		const response = await startRefresh()
		permissions = {
			...permissions,
			state: 'READ_ONLY',
			permissions: ['sales:read']
		}
		await act(async () => {
			response.resolve(permissions)
			await response.pending
		})
		await screen.findByRole('button', { name: task.title })
		expect(screen.queryByLabelText('Название задачи')).toBeNull()
		expect(
			screen.getByRole('button', { name: 'Новая задача' })
		).toHaveProperty('disabled', true)
		await openTaskReadonly()
		expect(titleField()).toHaveProperty('value', task.title)
		expect(titleField()).toHaveProperty('disabled', true)
	})
	it('refreshes tasks and the workspace-scoped Inbox summary using confirmed access', async () => {
		render(<MyDayScreen />, { wrapper: Wrapper })
		await screen.findByRole('button', { name: task.title })
		const invalidate = vi.spyOn(client, 'invalidateQueries')
		fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith(
				{ queryKey: ['crm-inbox', workspaceId], refetchType: 'active' },
				{ throwOnError: true }
			)
		)
	})
})
const openTaskReadonly = async () => {
	fireEvent.click(screen.getByRole('button', { name: task.title }))
	await waitFor(() => expect(titleField().closest('[hidden]')).toBeNull())
}
