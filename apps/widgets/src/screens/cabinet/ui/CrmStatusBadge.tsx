'use client'

import { crmProductService } from '@/entities/crm-product'
import { useAuthStore, useUser } from '@/entities/user'
import { CRM_RELEASE } from '@/shared/config/crm-release.config'
import Link from '@/shared/lib/navigation/ZoneLink'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import styles from './CrmStatusBadge.module.scss'

const formatDate = (value: string) =>
	`${new Intl.DateTimeFormat('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/Moscow'
	}).format(new Date(value))} МСК`

export default function CrmStatusBadge() {
	const auth = useAuthStore(state => state.auth)
	const isAuthResolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading } = useUser()
	const canLoad =
		CRM_RELEASE.apiEnabled &&
		isAuthResolved &&
		auth &&
		!isLoading &&
		Boolean(user.id)
	const query = useQuery({
		queryKey: ['crm-profile-status', user.id],
		queryFn: ({ signal }) => crmProductService.getProfileStatus(signal),
		enabled: canLoad,
		staleTime: 0,
		refetchInterval: 60_000,
		retry: 1
	})
	const status = canLoad && !query.isError ? query.data : undefined
	const retry = async () => {
		if (!canLoad || query.isFetching) return
		const id = toast.loading('Проверяем статус WinCRM...')
		const result = await query.refetch()
		if (result.isError)
			toast.error('Статус WinCRM временно недоступен', { id })
		else toast.success('Статус WinCRM обновлён', { id })
	}
	const label = !CRM_RELEASE.apiEnabled
		? CRM_RELEASE.unavailableLabel
		: query.isError
			? 'Статус недоступен'
			: (status?.label ?? 'Проверяем статус...')

	return (
		<div className={styles.row} aria-label="Подписка WinCRM" role="status">
			<span
				className={`${styles.badge} ${styles[status?.tone ?? 'neutral']}`}
			>
				WinCRM
			</span>
			<span className={styles.status}>{label}</span>
			{status?.expiresAt && (
				<span className={styles.expiry}>
					до {formatDate(status.expiresAt)}
				</span>
			)}
			{CRM_RELEASE.apiEnabled && query.isError ? (
				<button
					type="button"
					className={styles.action}
					disabled={!canLoad || query.isFetching}
					onClick={() => void retry()}
				>
					{query.isFetching ? 'Проверяем...' : 'Обновить'}
				</button>
			) : CRM_RELEASE.apiEnabled && status ? (
				<Link
					href={CRM_RELEASE.appUrl}
					className={styles.action}
					onClick={() => toast('Переходим в WinCRM')}
				>
					Перейти в CRM
				</Link>
			) : null}
		</div>
	)
}
