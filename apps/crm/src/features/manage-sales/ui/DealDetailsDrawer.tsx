'use client'

import {
	getSalesDeal,
	listSalesTimeline,
	type SalesDeal,
	type SalesPipeline
} from '@/entities/sales'
import {
	Button,
	Drawer,
	ScreenState,
	SelectField,
	StatusBadge,
	TextareaField,
	TextField
} from '@/shared/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { useSalesCommand } from '../model/use-sales-command'
import { useSalesSession } from '../model/use-sales-session'
import { SalesCommandState } from './SalesCommandState'
import styles from './SalesWorkflow.module.scss'

export const salesMoney = (minor: number) =>
	new Intl.NumberFormat('ru-RU', {
		style: 'currency',
		currency: 'RUB',
		maximumFractionDigits: 2
	}).format(minor / 100)
export const salesDate = (date: string) =>
	new Intl.DateTimeFormat('ru-RU', {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(date))
const statuses = {
	OPEN: 'В работе',
	WON: 'Успешно',
	LOST: 'Отказ'
} as const
const historyLabels = {
	CREATED: 'Сделка создана',
	TRANSITIONED: 'Этап изменён',
	TASK_COMPLETED: 'Действие выполнено',
	ARCHIVED: 'Сделка архивирована'
} as const

const DealEditor = ({
	deal,
	pipeline,
	enabled,
	command
}: {
	deal: SalesDeal
	pipeline: SalesPipeline | undefined
	enabled: boolean
	command: ReturnType<typeof useSalesCommand>
}) => {
	const [expectedVersion] = useState(deal.version)
	const [targetStageId, setTargetStageId] = useState(deal.stageId)
	const [outcome, setOutcome] = useState('')
	const [taskTitle, setTaskTitle] = useState('')
	const [due, setDue] = useState('')
	const [confirmArchive, setConfirmArchive] = useState(false)
	const target = pipeline?.stages.find(stage => stage.id === targetStageId)
	const submit = (event: FormEvent) => {
		event.preventDefault()
		if (!enabled || command.locked) return
		if (!target) {
			toast.error('Выберите доступный этап')
			return
		}
		if (target.state === 'OPEN' && !Number.isFinite(Date.parse(due))) {
			toast.error('Укажите срок следующего действия')
			return
		}
		void command.execute({
			kind: 'transition',
			id: deal.id,
			expectedVersion,
			targetStageId,
			outcome: outcome.trim(),
			...(target.state === 'OPEN'
				? {
						nextTask: {
							title: taskTitle.trim(),
							dueAt: new Date(due).toISOString()
						}
					}
				: {})
		})
	}
	return (
		<section className={styles.section}>
			<h3>Результат и следующий шаг</h3>
			{!enabled ? (
				<p className={styles.muted}>
					Изменения доступны после проверки актуальных данных и прав.
				</p>
			) : null}
			<form className={styles.form} onSubmit={submit}>
				<fieldset
					className={styles.fields}
					disabled={command.locked || !enabled}
				>
					<SelectField
						label="Следующий этап"
						value={targetStageId}
						onChange={event => setTargetStageId(event.target.value)}
					>
						{pipeline?.stages.map(stage => (
							<option key={stage.id} value={stage.id}>
								{stage.name}
							</option>
						))}
					</SelectField>
					<TextareaField
						label="Что сделано / результат"
						value={outcome}
						onChange={event => setOutcome(event.target.value)}
						required
						maxLength={4000}
						rows={3}
					/>
					{target?.state === 'OPEN' ? (
						<>
							<TextField
								label="Следующее действие"
								value={taskTitle}
								onChange={event => setTaskTitle(event.target.value)}
								required
								maxLength={200}
							/>
							<TextField
								label="Срок следующего действия"
								type="datetime-local"
								value={due}
								onChange={event => setDue(event.target.value)}
								required
							/>
						</>
					) : (
						<p className={styles.muted}>
							Текущее действие завершится вместе со сделкой.
						</p>
					)}
					<Button
						type="submit"
						tooltip="Сохранить результат текущего действия и переход на выбранный этап сделки."
						isLoading={command.pending}
						disabled={!target}
					>
						Сохранить результат
					</Button>
				</fieldset>
			</form>
			{confirmArchive ? (
				<div className={styles.error}>
					<p>
						Архивировать сделку? Открытое действие будет отменено. История
						сохранится.
					</p>
					<div className={styles.actions}>
						<Button
							variant="danger"
							disabled={command.locked || !enabled}
							onClick={() =>
								void command.execute({
									kind: 'archive',
									id: deal.id,
									expectedVersion
								})
							}
						>
							Да, архивировать
						</Button>
						<Button
							variant="ghost"
							disabled={command.locked}
							onClick={() => setConfirmArchive(false)}
						>
							Отмена
						</Button>
					</div>
				</div>
			) : (
				<Button
					variant="ghost"
					disabled={command.locked || !enabled}
					tooltip="Открыть подтверждение архивации: сделка уйдёт из активных, открытое действие будет отменено, история сохранится."
					onClick={() => setConfirmArchive(true)}
				>
					Архивировать сделку
				</Button>
			)}
		</section>
	)
}

export const DealDetailsDrawer = ({
	id,
	pipelines,
	onClose,
	onSaved
}: {
	id: string
	pipelines: SalesPipeline[]
	onClose: () => void
	onSaved: () => void
}) => {
	const context = useSalesSession()
	const queryClient = useQueryClient()
	const [page, setPage] = useState(1)
	const [openedAt] = useState(() => Date.now())
	const [editorRevision, setEditorRevision] = useState(0)
	const detail = useQuery({
		queryKey: ['sales', 'deal', ...context.key, id],
		enabled: context.canRead && !!context.session,
		queryFn: () =>
			getSalesDeal(
				context.session!.accessToken,
				context.workspace.workspaceId,
				id
			),
		retry: false,
		gcTime: 0
	})
	const history = useQuery({
		queryKey: ['sales', 'timeline', ...context.key, id, page],
		enabled:
			context.canRead &&
			!!context.session &&
			!!detail.data &&
			!detail.isError,
		queryFn: () =>
			listSalesTimeline(
				context.session!.accessToken,
				context.workspace.workspaceId,
				id,
				page
			),
		retry: false,
		gcTime: 0
	})
	const deal = detail.data
	const pipeline = pipelines.find(item => item.id === deal?.pipelineId)
	const reload = async () => {
		const [auth, record] = await Promise.all([
			context.permissions.refetch(),
			detail.refetch()
		])
		if (auth.isError || record.isError)
			throw new Error('Не удалось обновить данные')
	}
	const command = useSalesCommand(
		context.workspace.workspaceId,
		context.session?.accessToken || '',
		context.canWrite,
		result => {
			queryClient.setQueryData(
				['sales', 'deal', ...context.key, id],
				result
			)
			setEditorRevision(value => value + 1)
			onSaved()
			if (result.archivedAt) onClose()
			else {
				void detail.refetch()
				void history.refetch()
			}
		},
		`deal:${id}`,
		context.scopeKey
	)
	return (
		<Drawer
			isOpen
			onClose={() => {
				if (command.canClose()) onClose()
			}}
			title={
				context.canRead && !detail.isError
					? deal?.title || 'Сделка'
					: 'Сделка'
			}
			description="Карточка, история и обязательное следующее действие."
		>
			<SalesCommandState
				command={command}
				onReview={async () => {
					await reload()
					command.resetAfterReview()
					setEditorRevision(value => value + 1)
				}}
			/>
			{!context.canRead ? (
				<ScreenState
					variant={
						context.permissions.isPending ? 'loading' : 'permission'
					}
				/>
			) : detail.isError ? (
				<ScreenState
					variant="error"
					description="Карточка недоступна. Данные не показаны до успешной проверки."
					action={
						<Button onClick={() => void detail.refetch()}>
							Повторить
						</Button>
					}
				/>
			) : detail.isPending || !deal ? (
				<ScreenState variant="loading" />
			) : (
				<div className={styles.content}>
					<div className={styles.summary}>
						<span>
							{pipeline?.stages.find(stage => stage.id === deal.stageId)
								?.name || statuses[deal.status]}
						</span>
						<strong>{salesMoney(deal.amountMinor)}</strong>
						<span>{deal.contactName}</span>
					</div>
					<dl className={styles.details}>
						<div>
							<dt>Статус</dt>
							<dd>{statuses[deal.status]}</dd>
						</div>
						<div>
							<dt>Ответственный</dt>
							<dd>
								{deal.assignedToSubject ===
								context.permissions.data?.subject
									? 'Вы'
									: deal.assignedToSubject}
							</dd>
						</div>
						<div>
							<dt>Следующее действие</dt>
							<dd>{deal.nextTask?.title || 'Сделка закрыта'}</dd>
						</div>
						<div>
							<dt>Срок</dt>
							<dd>
								{deal.nextTask ? salesDate(deal.nextTask.dueAt) : '—'}
							</dd>
						</div>
					</dl>
					{deal.nextTask && Date.parse(deal.nextTask.dueAt) < openedAt ? (
						<StatusBadge tone="danger">Действие просрочено</StatusBadge>
					) : null}
					<DealEditor
						key={editorRevision}
						deal={deal}
						pipeline={pipeline}
						enabled={context.canWrite && !detail.isFetching && !!pipeline}
						command={command}
					/>
					<section className={styles.section}>
						<h3>История сделки</h3>
						{history.isError ? (
							<ScreenState
								variant="error"
								compact
								action={
									<Button
										variant="secondary"
										onClick={() => void history.refetch()}
									>
										Повторить
									</Button>
								}
							/>
						) : history.isPending ? (
							<ScreenState variant="loading" compact />
						) : (
							<>
								<ol className={styles.history}>
									{history.data?.items.map(item => (
										<li key={item.id}>
											<strong>{historyLabels[item.kind]}</strong>
											<p>{item.outcome}</p>
											<time dateTime={item.createdAt}>
												{salesDate(item.createdAt)}
											</time>
										</li>
									))}
								</ol>
								<div className={styles.pagination}>
									<Button
										size="sm"
										variant="ghost"
										disabled={page === 1 || history.isFetching}
										onClick={() => setPage(value => value - 1)}
									>
										Назад
									</Button>
									<span>Страница {page}</span>
									<Button
										size="sm"
										variant="ghost"
										disabled={
											page * 10 >= (history.data?.total || 0) ||
											history.isFetching
										}
										onClick={() => setPage(value => value + 1)}
									>
										Далее
									</Button>
								</div>
							</>
						)}
					</section>
				</div>
			)}
		</Drawer>
	)
}
