'use client'

import styles from '@/screens/cabinet/ui/Cabinet.module.scss'
import CabinetAffiliate from '@/screens/cabinet/ui/CabinetAffiliate'
import CabinetPayments from '@/screens/cabinet/ui/CabinetPayments'
import CabinetProfile from '@/screens/cabinet/ui/CabinetProfile'
import CabinetSessions from '@/screens/cabinet/ui/CabinetSessions'
import CabinetWidgets from '@/screens/cabinet/ui/CabinetWidgets'
import CrmStatusBadge from './CrmStatusBadge'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import { useUser } from '@/entities/user'
import { affiliateService } from '@/entities/affiliate'
import { widgetService } from '@/entities/site-widget'
import { useAuthStore } from '@/entities/user'
import { useQuery } from '@tanstack/react-query'
import Image from 'next/image'
import { usePathname, useSearchParams } from 'next/navigation'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import { FC, useEffect, useState } from 'react'

type Tab = 'widgets' | 'payments' | 'profile' | 'sessions' | 'affiliate'

const isTab = (value: string | null): value is Tab =>
	value === 'widgets' ||
	value === 'payments' ||
	value === 'profile' ||
	value === 'sessions' ||
	value === 'affiliate'

const planLabel: Record<string, string> = {
	TRIAL: 'Тест-драйв',
	EASY: 'Easy',
	HARD: 'Hard'
}

const formatSubscriptionExpiresAt = (value: string) =>
	`${new Intl.DateTimeFormat('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/Moscow'
	}).format(new Date(value))} МСК`

const Cabinet: FC = () => {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()
	const requestedTab = searchParams.get('tab')
	const initialTab: Tab = isTab(requestedTab) ? requestedTab : 'widgets'
	const [tab, setTab] = useState<Tab>(initialTab)
	const auth = useAuthStore(state => state.auth)
	const { user, isLoading } = useUser()

	const { data } = useQuery({
		queryKey: ['widgets'],
		queryFn: widgetService.getMyWidgets,
		enabled: auth
	})
	const { data: affiliateSettings, isLoading: affiliateSettingsLoading } =
		useQuery({
			queryKey: ['affiliate-public-settings'],
			queryFn: affiliateService.getPublicSettings,
			enabled: auth
		})

	const subscription = data?.subscription
	const isAffiliateEnabled = Boolean(affiliateSettings?.enabled)
	const planName = subscription
		? planLabel[subscription.plan] || subscription.plan
		: null

	const displayName = user?.name || 'Пользователь'
	const displaySub = user?.email || user?.phone || ''

	useEffect(() => {
		if (
			!affiliateSettingsLoading &&
			tab === 'affiliate' &&
			!isAffiliateEnabled
		) {
			setTab('widgets')
		}
	}, [affiliateSettingsLoading, isAffiliateEnabled, tab])

	useEffect(() => {
		const nextTab = isTab(requestedTab) ? requestedTab : 'widgets'

		if (
			nextTab === 'affiliate' &&
			!affiliateSettingsLoading &&
			!isAffiliateEnabled
		) {
			setTab('widgets')
			return
		}

		setTab(nextTab)
	}, [affiliateSettingsLoading, isAffiliateEnabled, requestedTab])

	const changeTab = (nextTab: Tab) => {
		setTab(nextTab)
		const nextSearchParams = new URLSearchParams(searchParams.toString())

		if (nextTab === 'widgets') {
			nextSearchParams.delete('tab')
		} else {
			nextSearchParams.set('tab', nextTab)
		}

		const query = nextSearchParams.toString()
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false
		})
	}

	return (
		<div className={styles.cabinet}>
			{/* ── User header ─────────────────────────────────────── */}
			<div className={styles.userHeader}>
				{isLoading ? (
					<div className={styles.avatarSkeleton}>
						<SkeletonLoader count={1} circle className="w-full h-full" />
					</div>
				) : (
					<Image
						src={user?.avatarPath || '/avatar-default.png'}
						alt={displayName}
						width={52}
						height={52}
						className={styles.avatarImg}
					/>
				)}
				<div className={styles.headerInfo}>
					{isLoading ? (
						<div className={styles.headerInfoSkeleton} aria-hidden="true">
							<div className={styles.headerNameSkeleton}>
								<SkeletonLoader count={1} className="w-full h-full" />
							</div>
							<div className={styles.headerSubSkeleton}>
								<SkeletonLoader count={1} className="w-full h-full" />
							</div>
							<div className={styles.headerPlanRow}>
								<div className={styles.headerBadgeSkeleton}>
									<SkeletonLoader count={1} className="w-full h-full" />
								</div>
								<div className={styles.headerExpiresSkeleton}>
									<SkeletonLoader count={1} className="w-full h-full" />
								</div>
							</div>
						</div>
					) : (
						<>
							<p className={styles.headerName}>{displayName}</p>
							{displaySub && (
								<p className={styles.headerSub}>{displaySub}</p>
							)}
							{(planName || subscription?.expiresAt) && (
								<div className={styles.headerPlanRow}>
									{planName && (
										<span className={styles.planBadge}>{planName}</span>
									)}
									{subscription?.expiresAt && (
										<p className={styles.planExpires}>
											до{' '}
											{formatSubscriptionExpiresAt(subscription.expiresAt)}
										</p>
									)}
								</div>
							)}
							<CrmStatusBadge />
						</>
					)}
				</div>
			</div>

			{/* ── Tabs ────────────────────────────────────────────── */}
			<div
				className={styles.tabs}
				role="tablist"
				aria-label="Разделы кабинета"
			>
				<button
					type="button"
					role="tab"
					aria-selected={tab === 'widgets'}
					className={`${styles.tab} ${tab === 'widgets' ? styles.tabActive : ''}`}
					onClick={() => changeTab('widgets')}
				>
					Виджеты
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === 'payments'}
					className={`${styles.tab} ${tab === 'payments' ? styles.tabActive : ''}`}
					onClick={() => changeTab('payments')}
				>
					Платежи
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === 'profile'}
					className={`${styles.tab} ${tab === 'profile' ? styles.tabActive : ''}`}
					onClick={() => changeTab('profile')}
				>
					Профиль
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === 'sessions'}
					className={`${styles.tab} ${tab === 'sessions' ? styles.tabActive : ''}`}
					onClick={() => changeTab('sessions')}
				>
					Активные сессии
				</button>
				{isAffiliateEnabled && (
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'affiliate'}
						className={`${styles.tab} ${tab === 'affiliate' ? styles.tabActive : ''}`}
						onClick={() => changeTab('affiliate')}
					>
						Рефералы
					</button>
				)}
			</div>

			{/* ── Content ─────────────────────────────────────────── */}
			<div className={styles.content}>
				{tab === 'widgets' && <CabinetWidgets />}
				{tab === 'payments' && <CabinetPayments />}
				{tab === 'profile' && <CabinetProfile />}
				{tab === 'sessions' && <CabinetSessions />}
				{tab === 'affiliate' && isAffiliateEnabled && <CabinetAffiliate />}
			</div>
		</div>
	)
}

export default Cabinet
