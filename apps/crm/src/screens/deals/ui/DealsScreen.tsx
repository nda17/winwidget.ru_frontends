'use client'

import {
	listSalesDeals,
	listSalesPipelines,
	type SalesDeal
} from '@/entities/sales'
import {
	CreateDealDrawer,
	DealDetailsDrawer,
	salesDate,
	salesMoney,
	useSalesSession
} from '@/features/manage-sales'
import {
	AppIcon,
	Button,
	DataTable,
	PageHeader,
	ReadOnlyBanner,
	ScreenState,
	SelectField,
	StatusBadge,
	TextField,
	type DataTableColumn
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import styles from './DealsScreen.module.scss'
import { ExportRecordsControl } from '@/features/export-records'

const DealsScreen = () => {
	const context = useSalesSession()
	const queryClient = useQueryClient()
	const [page, setPage] = useState(1)
	const [searchInput, setSearchInput] = useState('')
	const [search, setSearch] = useState('')
	const [pipelineId, setPipelineId] = useState('')
	const [status, setStatus] = useState('')
	const [withoutNextAction, setWithoutNextAction] = useState(false)
	const [selected, setSelected] = useState<string | null>(null)
	const [createOpen, setCreateOpen] = useState(false)
	const pipelines = useQuery({
		queryKey: ['sales', 'pipelines', ...context.key],
		enabled: context.canRead && !!context.session,
		queryFn: () =>
			listSalesPipelines(
				context.session!.accessToken,
				context.workspace.workspaceId
			),
		retry: false,
		gcTime: 0
	})
	const deals = useQuery({
		queryKey: [
			'sales',
			'deals',
			...context.key,
			page,
			search,
			pipelineId,
			status,
			withoutNextAction
		],
		enabled: context.canRead && !!context.session,
		queryFn: () =>
			listSalesDeals(
				context.session!.accessToken,
				context.workspace.workspaceId,
				page,
				20,
				search,
				pipelineId,
				status,
				withoutNextAction
			),
		retry: false,
		gcTime: 0
	})
	const emptyPage =
		!!deals.data && deals.data.total > 0 && deals.data.items.length === 0
	const reload = async () => {
		const result = await Promise.all([
			context.permissions.refetch(),
			pipelines.refetch(),
			deals.refetch()
		])
		if (result.every(item => !item.isError))
			toast.success('Данные обновлены')
		else toast.error('Не удалось обновить данные')
	}
	const saved = () => {
		void queryClient.invalidateQueries({ queryKey: ['sales'] })
	}
	const submitSearch = (event: FormEvent) => {
		event.preventDefault()
		setSearch(searchInput.trim())
		setPage(1)
	}
	const columns: DataTableColumn<SalesDeal>[] = [
		{
			id: 'deal',
			header: 'Сделка / клиент',
			render: deal => (
				<button
					type="button"
					className={styles.record}
					onClick={() => setSelected(deal.id)}
				>
					<strong>{deal.title}</strong>
					<span>{deal.contactName}</span>
				</button>
			)
		},
		{
			id: 'stage',
			header: 'Этап',
			render: deal => (
				<StatusBadge
					tone={
						deal.status === 'WON'
							? 'success'
							: deal.status === 'LOST'
								? 'danger'
								: 'info'
					}
				>
					{pipelines.data
						?.find(item => item.id === deal.pipelineId)
						?.stages.find(item => item.id === deal.stageId)?.name ||
						{ OPEN: 'В работе', WON: 'Успешно', LOST: 'Отказ' }[
							deal.status
						]}
				</StatusBadge>
			)
		},
		{
			id: 'amount',
			header: 'Сумма',
			render: deal => salesMoney(deal.amountMinor),
			align: 'right'
		},
		{
			id: 'next',
			header: 'Следующее действие',
			render: deal =>
				deal.nextTask ? (
					<div className={styles.copy}>
						<strong>{deal.nextTask.title}</strong>
						<span>{salesDate(deal.nextTask.dueAt)}</span>
						{Date.parse(deal.nextTask.dueAt) < Date.now() ? (
							<StatusBadge tone="danger">Просрочено</StatusBadge>
						) : null}
					</div>
				) : (
					<span className={styles.muted}>
						{deal.status === 'OPEN'
							? 'Нет следующего действия'
							: 'Сделка закрыта'}
					</span>
				)
		}
	]
	return (
		<div className={styles.screen}>
			<PageHeader
				eyebrow="Продажи"
				title="Сделки"
				description="Клиенты, этапы продаж и следующее действие по каждой открытой сделке."
				actions={
					<>
						<ExportRecordsControl entity="deals" />
						<Button
							variant="secondary"
							onClick={() => void reload()}
							leadingIcon={<AppIcon name="refresh" size={18} />}
						>
							Обновить
						</Button>
						<Button
							disabled={
								!context.canWrite ||
								pipelines.isError ||
								pipelines.isFetching ||
								!pipelines.data?.length
							}
							onClick={() => setCreateOpen(true)}
							leadingIcon={<AppIcon name="plus" size={18} />}
						>
							Новая сделка
						</Button>
					</>
				}
			/>
			{context.permissions.isError ? (
				<ScreenState
					variant="error"
					description="Не удалось проверить права. Данные скрыты до успешной проверки."
					action={
						<Button onClick={() => void context.permissions.refetch()}>
							Повторить
						</Button>
					}
				/>
			) : context.permissions.isPending ? (
				<ScreenState variant="loading" />
			) : !context.canRead ? (
				<ScreenState
					variant="permission"
					description="Ваша роль не даёт доступа к карточкам сделок. Аналитика доступна в отдельном разделе."
				/>
			) : (
				<>
					{!context.workspace.canWrite ||
					context.permissions.data?.state === 'READ_ONLY' ? (
						<ReadOnlyBanner description="Вы можете просматривать сделки и историю. Изменения возобновятся после активации подписки." />
					) : null}
					<form className={styles.filters} onSubmit={submitSearch}>
						<TextField
							label="Поиск по сделке или клиенту"
							value={searchInput}
							onChange={event => setSearchInput(event.target.value)}
							maxLength={200}
						/>
						<SelectField
							label="Воронка"
							value={pipelineId}
							onChange={event => {
								setPipelineId(event.target.value)
								setPage(1)
							}}
							disabled={pipelines.isError || pipelines.isFetching}
						>
							<option value="">Все воронки</option>
							{pipelines.data?.map(item => (
								<option key={item.id} value={item.id}>
									{item.name}
								</option>
							))}
						</SelectField>
						<SelectField
							label="Статус"
							value={status}
							onChange={event => {
								setStatus(event.target.value)
								setPage(1)
							}}
						>
							<option value="">Все статусы</option>
							<option value="OPEN">В работе</option>
							<option value="WON">Успешно</option>
							<option value="LOST">Отказ</option>
						</SelectField>
						<Button type="submit" variant="secondary">
							Найти
						</Button>
						<label className={styles.nextActionFilter}>
							<input
								type="checkbox"
								checked={withoutNextAction}
								disabled={!context.canRead}
								onChange={event => {
									if (!context.canRead) return
									const enabled = event.target.checked
									setWithoutNextAction(enabled)
									setPage(1)
									toast(
										enabled
											? 'Фильтр «Без следующего действия» включён'
											: 'Фильтр «Без следующего действия» выключен'
									)
								}}
							/>
							<span>Без следующего действия</span>
						</label>
					</form>
					{deals.isError || pipelines.isError ? (
						<ScreenState
							variant="error"
							description="Не удалось загрузить актуальные сделки и этапы."
							action={
								<Button onClick={() => void reload()}>Повторить</Button>
							}
						/>
					) : deals.isPending || pipelines.isPending || !deals.data ? (
						<ScreenState variant="loading" />
					) : emptyPage ? (
						<ScreenState
							variant="empty"
							title="На этой странице больше нет сделок"
							description="Список изменился. Подходящие сделки есть на других страницах — вернитесь на первую страницу."
							action={
								<Button
									disabled={!context.canRead || deals.isFetching}
									onClick={() => {
										if (!context.canRead || deals.isFetching) return
										if (page === 1) void deals.refetch()
										else setPage(1)
										toast('Переход на первую страницу сделок')
									}}
								>
									На первую страницу
								</Button>
							}
						/>
					) : deals.data.total === 0 ? (
						<ScreenState
							variant="empty"
							title={
								search || status || pipelineId || withoutNextAction
									? 'Подходящих сделок нет'
									: 'Создайте первую сделку'
							}
							description={
								withoutNextAction
									? 'Нет открытых сделок без запланированных задач по выбранным условиям. Измените фильтры, чтобы увидеть другие сделки.'
									: 'Выберите контакт, сумму и первое действие — и начните работу с клиентом.'
							}
							action={
								<Button
									disabled={!context.canWrite || !pipelines.data?.length}
									onClick={() => setCreateOpen(true)}
								>
									Новая сделка
								</Button>
							}
						/>
					) : (
						<DataTable
							mobileLayout="cards"
							caption="Сделки компании"
							rows={deals.data.items}
							columns={columns}
							getRowKey={deal => deal.id}
						/>
					)}
					{deals.data && !deals.isError ? (
						<div className={styles.pagination}>
							<span>
								Всего {deals.data.total} ·{' '}
								{emptyPage
									? `страница ${page} больше не содержит сделок`
									: `страница ${page}`}
							</span>
							<div className={styles.actions}>
								<Button
									variant="secondary"
									size="sm"
									disabled={page === 1 || deals.isFetching}
									onClick={() => setPage(value => value - 1)}
								>
									Назад
								</Button>
								<Button
									variant="secondary"
									size="sm"
									disabled={
										page * 20 >= deals.data.total || deals.isFetching
									}
									onClick={() => setPage(value => value + 1)}
								>
									Далее
								</Button>
							</div>
						</div>
					) : null}
				</>
			)}
			{createOpen && pipelines.data ? (
				<CreateDealDrawer
					key={context.key.join(':')}
					pipelines={pipelines.data}
					onClose={() => setCreateOpen(false)}
					onSaved={saved}
				/>
			) : null}
			{selected ? (
				<DealDetailsDrawer
					key={`${context.key.join(':')}:${selected}`}
					id={selected}
					pipelines={pipelines.isError ? [] : pipelines.data || []}
					onClose={() => setSelected(null)}
					onSaved={saved}
				/>
			) : null}
		</div>
	)
}

export default DealsScreen
