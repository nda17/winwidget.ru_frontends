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
import type { ReminderContext } from '../model/use-reminder-session'
import { TaskNotificationPanel } from './TaskNotificationCenter'
import type { DrawerProps } from '@/shared/ui/drawer/Drawer'
vi.mock('@/entities/crm-task-notifications', () => ({
	listTaskNotifications: vi.fn(),
	setTaskNotificationRead: vi.fn()
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
		current: () => true
	} as ReminderContext
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
