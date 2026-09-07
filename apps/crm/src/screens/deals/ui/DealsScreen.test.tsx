import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import {
	listSalesDeals,
	listSalesPipelines,
	type SalesDeal
} from '@/entities/sales'
import { useSalesSession } from '@/features/manage-sales'
import DealsScreen from './DealsScreen'

vi.mock('@/entities/sales', () => ({
	listSalesDeals: vi.fn(),
	listSalesPipelines: vi.fn()
}))
vi.mock('@/features/manage-sales', () => ({
	useSalesSession: vi.fn(),
	CreateDealDrawer: () => null,
	DealDetailsDrawer: () => null,
	salesDate: (date: string) => date,
	salesMoney: (amount: number) => String(amount)
}))
vi.mock('@/features/export-records', () => ({
	ExportRecordsControl: () => null
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const pipelineId = '22222222-2222-4222-8222-222222222222'
const stageId = '33333333-3333-4333-8333-333333333333'
const date = '2026-09-07T12:00:00.000Z'
const deal: SalesDeal = {
	id: '44444444-4444-4444-8444-444444444444',
	workspaceId,
	version: 1,
	title: 'Новый заказ',
	currency: 'RUB',
	amountMinor: 10000,
	pipelineId,
	stageId,
	status: 'OPEN',
	contactId: '55555555-5555-4555-8555-555555555555',
	contactName: 'Клиент',
	assignedToSubject: 'actor',
	teamId: null,
	archivedAt: null,
	createdAt: date,
	updatedAt: date,
	nextTask: null
}
const permissionsRefetch = vi.fn(async () => ({ isError: false }))
const context = {
	session: { userId: 'actor', accessToken: 'test-token' },
	sessionRevision: 1,
	workspace: { workspaceId, canWrite: true },
	canRead: true,
	canWrite: true,
	key: [workspaceId, 'actor', 1, 'ALL'],
	permissions: {
		isError: false,
		isPending: false,
		data: { role: 'OWNER', state: 'ACTIVE' },
		refetch: permissionsRefetch
	}
}
let client: QueryClient
const view = () => (
	<QueryClientProvider client={client}>
		<DealsScreen />
	</QueryClientProvider>
)
const checkbox = () =>
	screen.getByRole('checkbox', {
		name: 'Без следующего действия'
	}) as HTMLInputElement
const ready = async () => {
	await screen.findByRole('button', { name: 'Новый заказ Клиент' })
	await waitFor(() =>
		expect(
			(screen.getByRole('button', { name: 'Далее' }) as HTMLButtonElement)
				.disabled
		).toBe(false)
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } }
	})
	vi.mocked(useSalesSession).mockReturnValue(context as never)
	vi.mocked(listSalesPipelines).mockResolvedValue([
		{
			id: pipelineId,
			workspaceId,
			name: 'Продажи',
			templateKey: 'sales',
			templateVersion: 1,
			stages: [
				{
					id: stageId,
					key: 'new',
					name: 'Новая',
					position: 0,
					state: 'OPEN'
				}
			]
		}
	])
	vi.mocked(listSalesDeals).mockImplementation(
		async (
			_token,
			_workspace,
			page,
			pageSize,
			_search,
			_pipeline,
			status,
			flag
		) => {
			const empty = flag && (status === 'WON' || status === 'LOST')
			return {
				schemaVersion: 1,
				page,
				pageSize,
				total: empty ? 0 : flag ? 1 : 21,
				items: empty ? [] : [deal]
			}
		}
	)
})
afterEach(() => {
	cleanup()
	client.clear()
})

describe('deal list without-next-action filter', () => {
	it.each(['ACTIVE', 'READ_ONLY'] as const)(
		'offers explicit first-page recovery when the last page becomes empty in %s',
		async state => {
			let removed = false
			vi.mocked(useSalesSession).mockReturnValue({
				...context,
				canWrite: state === 'ACTIVE',
				workspace: { ...context.workspace, canWrite: state === 'ACTIVE' },
				permissions: {
					...context.permissions,
					data: { role: 'OWNER', state }
				}
			} as never)
			vi.mocked(listSalesDeals).mockImplementation(
				async (_token, _workspace, page, pageSize) => ({
					schemaVersion: 1,
					page,
					pageSize,
					total: removed ? 20 : 21,
					items: removed && page === 2 ? [] : [deal]
				})
			)
			render(view())
			await ready()
			fireEvent.click(checkbox())
			await waitFor(() =>
				expect(listSalesDeals).toHaveBeenLastCalledWith(
					'test-token',
					workspaceId,
					1,
					20,
					'',
					'',
					'',
					true
				)
			)
			await ready()
			fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
			await screen.findByText('Всего 21 · страница 2')
			removed = true
			fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
			await screen.findByText('На этой странице больше нет сделок')
			expect(
				screen.getByText('Всего 20 · страница 2 больше не содержит сделок')
			).toBeTruthy()
			expect(screen.queryByText('Подходящих сделок нет')).toBeNull()
			expect(screen.queryByText('Создайте первую сделку')).toBeNull()
			expect(
				screen.queryByText(/Нет открытых сделок без запланированных задач/)
			).toBeNull()
			// Refresh must not silently change the selected server page.
			expect(listSalesDeals).toHaveBeenLastCalledWith(
				'test-token',
				workspaceId,
				2,
				20,
				'',
				'',
				'',
				true
			)
			const firstPage = screen.getByRole('button', {
				name: 'На первую страницу'
			}) as HTMLButtonElement
			expect(firstPage.disabled).toBe(false)
			fireEvent.click(firstPage)
			await screen.findByText('Всего 20 · страница 1')
			expect(
				screen.getByRole('button', { name: 'Новый заказ Клиент' })
			).toBeTruthy()
			expect(
				screen.queryByText('На этой странице больше нет сделок')
			).toBeNull()
			expect(listSalesDeals).toHaveBeenLastCalledWith(
				'test-token',
				workspaceId,
				1,
				20,
				'',
				'',
				'',
				true
			)
			expect(toast).toHaveBeenLastCalledWith(
				'Переход на первую страницу сделок'
			)
			expect(checkbox().checked).toBe(true)
		}
	)
	it('starts disabled, resets server pagination on explicit toggle, and does not filter a loaded page locally', async () => {
		render(view())
		await ready()
		expect(checkbox().checked).toBe(false)
		expect(listSalesDeals).toHaveBeenLastCalledWith(
			'test-token',
			workspaceId,
			1,
			20,
			'',
			'',
			'',
			false
		)
		fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
		await waitFor(() =>
			expect(listSalesDeals).toHaveBeenLastCalledWith(
				'test-token',
				workspaceId,
				2,
				20,
				'',
				'',
				'',
				false
			)
		)
		fireEvent.click(checkbox())
		await screen.findByText('Всего 1 · страница 1')
		expect(listSalesDeals).toHaveBeenLastCalledWith(
			'test-token',
			workspaceId,
			1,
			20,
			'',
			'',
			'',
			true
		)
		expect(checkbox().checked).toBe(true)
		expect(toast).toHaveBeenLastCalledWith(
			'Фильтр «Без следующего действия» включён'
		)
		fireEvent.click(checkbox())
		await screen.findByText('Всего 21 · страница 1')
		expect(listSalesDeals).toHaveBeenLastCalledWith(
			'test-token',
			workspaceId,
			1,
			20,
			'',
			'',
			'',
			false
		)
		expect(toast).toHaveBeenLastCalledWith(
			'Фильтр «Без следующего действия» выключен'
		)
	})
	it('keeps pipeline, search and WON status when enabling the filter and shows an honest empty result', async () => {
		render(view())
		await ready()
		fireEvent.change(screen.getByLabelText('Воронка'), {
			target: { value: pipelineId }
		})
		fireEvent.change(screen.getByLabelText('Статус'), {
			target: { value: 'WON' }
		})
		fireEvent.change(
			screen.getByLabelText('Поиск по сделке или клиенту'),
			{ target: { value: ' Клиент ' } }
		)
		fireEvent.click(screen.getByRole('button', { name: 'Найти' }))
		fireEvent.click(checkbox())
		await screen.findByText('Подходящих сделок нет')
		expect(listSalesDeals).toHaveBeenLastCalledWith(
			'test-token',
			workspaceId,
			1,
			20,
			'Клиент',
			pipelineId,
			'WON',
			true
		)
		expect(
			(screen.getByLabelText('Статус') as HTMLSelectElement).value
		).toBe('WON')
		expect(screen.queryByText('Создайте первую сделку')).toBeNull()
	})
	it('does not describe an OPEN deal without a task as a closed deal', async () => {
		render(view())
		await ready()
		expect(screen.getByText('Нет следующего действия')).toBeTruthy()
		expect(screen.queryByText('Сделка закрыта')).toBeNull()
	})
	it.each(['WON', 'LOST'] as const)(
		'preserves the closed label for %s without a task',
		async status => {
			vi.mocked(listSalesDeals).mockResolvedValue({
				schemaVersion: 1,
				page: 1,
				pageSize: 20,
				total: 21,
				items: [{ ...deal, status }]
			})
			render(view())
			await ready()
			expect(screen.getByText('Сделка закрыта')).toBeTruthy()
			expect(screen.queryByText('Нет следующего действия')).toBeNull()
		}
	)
	it('allows read-only filtering without enabling creation', async () => {
		vi.mocked(useSalesSession).mockReturnValue({
			...context,
			canWrite: false,
			workspace: { ...context.workspace, canWrite: false },
			permissions: {
				...context.permissions,
				data: { role: 'OWNER', state: 'READ_ONLY' }
			}
		} as never)
		render(view())
		await ready()
		expect(checkbox().disabled).toBe(false)
		fireEvent.click(checkbox())
		await screen.findByText('Всего 1 · страница 1')
		expect(
			(
				screen.getByRole('button', {
					name: 'Новая сделка'
				}) as HTMLButtonElement
			).disabled
		).toBe(true)
	})
	it('does not load or expose filter controls without confirmed read access', () => {
		vi.mocked(useSalesSession).mockReturnValue({
			...context,
			canRead: false,
			canWrite: false
		} as never)
		render(view())
		expect(screen.queryByRole('checkbox')).toBeNull()
		expect(listSalesDeals).not.toHaveBeenCalled()
		expect(listSalesPipelines).not.toHaveBeenCalled()
	})
	it('shows a server filter failure as error rather than an empty filtered page', async () => {
		render(view())
		await ready()
		vi.mocked(listSalesDeals).mockRejectedValue(
			new Error('private service detail')
		)
		fireEvent.click(checkbox())
		await screen.findByText(
			'Не удалось загрузить актуальные сделки и этапы.'
		)
		expect(screen.queryByText('Подходящих сделок нет')).toBeNull()
		expect(screen.queryByText('Создайте первую сделку')).toBeNull()
		expect(document.body.textContent).not.toContain(
			'private service detail'
		)
	})
})
