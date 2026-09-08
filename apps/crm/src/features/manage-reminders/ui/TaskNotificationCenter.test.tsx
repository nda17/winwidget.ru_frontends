import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	listTaskNotifications,
	setTaskNotificationRead
} from '@/entities/crm-task-notifications'
import {
	useReminderSession,
	type ReminderContext
} from '../model/use-reminder-session'
import {
	TaskNotificationCenter,
	TaskNotificationPanel
} from './TaskNotificationCenter'
import type { DrawerProps } from '@/shared/ui/drawer/Drawer'
vi.mock('@/entities/crm-task-notifications', () => ({
	listTaskNotifications: vi.fn(),
	setTaskNotificationRead: vi.fn()
}))
vi.mock('../model/use-reminder-session', () => ({
	useReminderSession: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
vi.mock('@/shared/ui', async original => ({
	...(await original<object>()),
	Drawer: ({ isOpen, title, children }: DrawerProps) =>
		isOpen ? (
			<section role="dialog" aria-label={String(title)}>
				{children}
			</section>
		) : null
}))
const workspaceId = '22222222-2222-4222-8222-222222222222',
	id = '11111111-1111-4111-8111-111111111111'
const data = {
	schemaVersion: 1 as const,
	workspaceId,
	page: 1,
	pageSize: 10,
	total: 1,
	unreadCount: 1,
	items: [
		{
			id,
			taskId: id,
			kind: 'ASSIGNED' as const,
			title: 'Current task',
			dueAt: '2026-09-08T12:00:00.000Z',
			createdAt: '2026-09-08T11:00:00.000Z',
			readAt: null,
			href: `/planner?task=${id}`
		}
	]
}
let client: QueryClient, context: ReminderContext
beforeEach(() => {
	vi.clearAllMocks()
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } }
	})
	context = {
		key: 'owner-key',
		canRead: true,
		canWrite: false,
		actorConfirmed: true,
		actor: { subject: 'owner', membershipId: null },
		session: { accessToken: 'token' },
		workspace: { workspaceId },
		permissions: {
			isSuccess: true,
			isFetching: false,
			isError: false,
			refetch: vi.fn()
		} as ReminderContext['permissions'],
		self: {
			enabled: true,
			loading: false,
			error: false,
			refetch: vi.fn()
		} as ReminderContext['self'],
		current: () => true
	} as ReminderContext
	vi.mocked(useReminderSession).mockImplementation(() => context)
	vi.mocked(listTaskNotifications).mockResolvedValue(data)
	vi.mocked(setTaskNotificationRead).mockResolvedValue({
		schemaVersion: 1,
		workspaceId,
		id,
		readAt: '2026-09-08T12:00:00.000Z'
	})
})
afterEach(() => {
	cleanup()
	client.clear()
})
const view = () => (
	<QueryClientProvider client={client}>
		<TaskNotificationPanel context={context} />
	</QueryClientProvider>
)
describe('task notification center', () => {
	it('shows server badge, safe task link and explicit read preference in READ_ONLY', async () => {
		render(view())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 1'
			})
		)
		expect(
			screen
				.getByRole('link', { name: 'Current task' })
				.getAttribute('href')
		).toBe(`/planner?task=${id}`)
		fireEvent.click(
			screen.getByRole('button', { name: 'Отметить прочитанным' })
		)
		await waitFor(() =>
			expect(setTaskNotificationRead).toHaveBeenCalledWith('token', {
				workspaceId,
				actorMembershipId: null,
				id,
				read: true
			})
		)
	})
	it('filters on server and never treats the browser as durable storage', async () => {
		render(view())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 1'
			})
		)
		fireEvent.click(
			screen.getByRole('checkbox', { name: 'Только непрочитанные' })
		)
		await waitFor(() =>
			expect(listTaskNotifications).toHaveBeenLastCalledWith('token', {
				workspaceId,
				actorMembershipId: null,
				page: 1,
				pageSize: 10,
				unreadOnly: true
			})
		)
	})
	it('hides old records and badge when exact actor proof is no longer available', async () => {
		const rendered = render(view())
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Уведомления, непрочитанных: 1'
			})
		)
		context = { ...context, actorConfirmed: false, current: () => false }
		rendered.rerender(view())
		expect(screen.queryByRole('link', { name: 'Current task' })).toBeNull()
		expect(
			screen.getByRole('button', { name: 'Уведомления' })
		).toBeTruthy()
		expect(setTaskNotificationRead).not.toHaveBeenCalled()
	})
	it('offers permission recovery instead of an endless loading message after a failed check', () => {
		context = {
			...context,
			canRead: false,
			actorConfirmed: false,
			actor: null,
			permissions: {
				...context.permissions,
				isSuccess: false,
				isError: true
			},
			current: () => false
		} as ReminderContext
		render(view())
		fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
		expect(screen.getByRole('alert').textContent).toContain(
			'Не удалось проверить доступ'
		)
		expect(screen.queryByText(/Проверяем доступ/)).toBeNull()
		fireEvent.click(
			screen.getByRole('button', { name: 'Проверить доступ' })
		)
		expect(context.permissions.refetch).toHaveBeenCalledOnce()
		expect(listTaskNotifications).not.toHaveBeenCalled()
		expect(setTaskNotificationRead).not.toHaveBeenCalled()
	})
	it.each([true, false])(
		'offers actor recovery after lookup error=%s without guessing a membership',
		error => {
			context = {
				...context,
				actorConfirmed: false,
				actor: null,
				self: { ...context.self, error, loading: false },
				current: () => true
			}
			render(view())
			fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
			expect(screen.getByRole('alert').textContent).toContain(
				'Не удалось подтвердить текущего сотрудника'
			)
			expect(screen.queryByText(/Проверяем доступ/)).toBeNull()
			fireEvent.click(
				screen.getByRole('button', { name: 'Проверить сотрудника' })
			)
			expect(context.self.refetch).toHaveBeenCalledOnce()
			expect(listTaskNotifications).not.toHaveBeenCalled()
			expect(setTaskNotificationRead).not.toHaveBeenCalled()
		}
	)
	it('keeps an in-flight actor lookup pending with data controls disabled', () => {
		context = {
			...context,
			actorConfirmed: false,
			actor: null,
			self: { ...context.self, loading: true },
			current: () => true
		}
		render(view())
		fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
		expect(screen.getByRole('status').textContent).toContain(
			'Проверяем доступ'
		)
		expect(screen.queryByRole('alert')).toBeNull()
		expect(
			screen
				.getByRole('button', { name: 'Обновить' })
				.hasAttribute('disabled')
		).toBe(true)
		expect(
			screen
				.getByRole('checkbox', { name: 'Только непрочитанные' })
				.hasAttribute('disabled')
		).toBe(true)
		expect(listTaskNotifications).not.toHaveBeenCalled()
	})
	it('keeps the drawer open across actor recovery but closes it for another session scope', async () => {
		const confirmed = context
		context = {
			...context,
			actorConfirmed: false,
			actor: null,
			self: { ...context.self, loading: true }
		}
		const center = () => (
			<QueryClientProvider client={client}>
				<TaskNotificationCenter />
			</QueryClientProvider>
		)
		const rendered = render(center())
		fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
		expect(
			screen.getByRole('dialog', { name: 'Уведомления' })
		).toBeTruthy()
		context = confirmed
		rendered.rerender(center())
		expect(
			await screen.findByRole('link', { name: 'Current task' })
		).toBeTruthy()
		expect(
			screen.getByRole('dialog', { name: 'Уведомления' })
		).toBeTruthy()
		context = {
			...context,
			key: 'another-session-scope',
			actorConfirmed: false,
			actor: null,
			self: { ...context.self, loading: true },
			current: () => false
		}
		rendered.rerender(center())
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(screen.queryByRole('link', { name: 'Current task' })).toBeNull()
	})
	it.each([
		{ role: 'ANALYST', permissions: ['sales:read'] },
		{ role: 'MANAGER', permissions: [] }
	])(
		'shows permission denied for confirmed $role restrictions without requesting data',
		async authority => {
			context = {
				...context,
				canRead: false,
				actorConfirmed: false,
				actor: null,
				session: { ...context.session!, userId: 'owner' },
				authority: { ...authority, subject: 'owner', workspaceId },
				permissions: { isSuccess: true, isFetching: false },
				current: () => false
			} as ReminderContext
			render(view())
			fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
			expect(screen.getByRole('alert').textContent).toContain(
				'Недостаточно прав'
			)
			expect(screen.queryByText(/Проверяем доступ/)).toBeNull()
			expect(
				screen
					.getByRole('button', { name: 'Обновить' })
					.hasAttribute('disabled')
			).toBe(true)
			expect(listTaskNotifications).not.toHaveBeenCalled()
			expect(setTaskNotificationRead).not.toHaveBeenCalled()
		}
	)
	it('does not treat an old or still refreshing permission result as a confirmed denial', () => {
		context = {
			...context,
			canRead: false,
			actorConfirmed: false,
			session: { ...context.session!, userId: 'owner' },
			authority: {
				role: 'ANALYST',
				permissions: ['sales:read'],
				subject: 'owner',
				workspaceId
			},
			permissions: { isSuccess: true, isFetching: true },
			current: () => false
		} as ReminderContext
		const rendered = render(view())
		fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
		expect(screen.getByRole('status').textContent).toContain(
			'Проверяем доступ'
		)
		expect(screen.queryByRole('alert')).toBeNull()
		context = {
			...context,
			permissions: { ...context.permissions, isFetching: false },
			authority: { ...context.authority!, subject: 'other-session' }
		}
		rendered.rerender(view())
		expect(screen.getByRole('status').textContent).toContain(
			'Проверяем доступ'
		)
		expect(screen.queryByRole('alert')).toBeNull()
		expect(listTaskNotifications).not.toHaveBeenCalled()
	})
})
