'use client'

import { crmProductService } from '@/entities/crm-product'
import { useAuthStore, useUser } from '@/entities/user'
import {
	CRM_RELEASE,
	getCrmAppUrl
} from '@/shared/config/crm-release.config'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import Link from '@/shared/lib/navigation/ZoneLink'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import pricingStyles from './Pricing.module.scss'
import styles from './CrmPricingCards.module.scss'

const rubles = new Intl.NumberFormat('ru-RU', {
	style: 'currency',
	currency: 'RUB',
	minimumFractionDigits: 0,
	maximumFractionDigits: 2
})

export default function CrmPricingCards() {
	const auth = useAuthStore(state => state.auth)
	const isAuthResolved = useAuthStore(state => state.isAuthResolved)
	const { user, isLoading: isUserLoading } = useUser()
	const canLoad =
		CRM_RELEASE.apiEnabled &&
		isAuthResolved &&
		auth &&
		!isUserLoading &&
		Boolean(user.id)
	const query = useQuery({
		queryKey: ['crm-public-commercial-policy', user.id],
		queryFn: ({ signal }) => crmProductService.getPolicy(signal),
		enabled: canLoad,
		staleTime: 60_000,
		retry: 1
	})
	const reload = async () => {
		if (!canLoad || query.isFetching) return
		const id = toast.loading('Загружаем тариф WinCRM...')
		const result = await query.refetch()
		if (result.isError)
			toast.error('Не удалось загрузить тариф WinCRM', { id })
		else toast.success('Тариф WinCRM обновлён', { id })
	}
	const policy = canLoad && !query.isError ? query.data : undefined

	return (
		<div className={styles.wrapper} aria-labelledby="crm-pricing-title">
			<div className={styles.intro}>
				<h2 id="crm-pricing-title" className={pricingStyles.title}>
					WinCRM
				</h2>
				<p className={styles.description}>
					Клиенты, сделки и задачи команды в одном рабочем пространстве.
				</p>
			</div>
			{!CRM_RELEASE.apiEnabled ? (
				<p className={styles.notice} role="status">
					WinCRM скоро появится. Тарифы и подключение станут доступны после
					запуска.
				</p>
			) : !isAuthResolved ||
			  isUserLoading ||
			  (canLoad && query.isPending) ? (
				<p className={styles.notice} role="status">
					Загружаем тариф WinCRM...
				</p>
			) : !auth ? (
				<p className={styles.notice}>
					<Link
						href={PUBLIC_PAGES.LOGIN}
						onClick={() => toast('Переходим ко входу')}
					>
						Войдите в аккаунт
					</Link>
					, чтобы увидеть актуальный тариф WinCRM.
				</p>
			) : query.isError ? (
				<div className={styles.notice} role="alert">
					<p>
						Не удалось загрузить тариф WinCRM. Стоимость временно
						недоступна.
					</p>
					<button
						type="button"
						className={styles.retry}
						disabled={query.isFetching}
						onClick={() => void reload()}
					>
						{query.isFetching ? 'Загружаем...' : 'Попробовать ещё раз'}
					</button>
				</div>
			) : null}
			<div className={pricingStyles.plans}>
				{(['MONTH', 'YEAR'] as const).map(period => {
					const yearly = period === 'YEAR'
					const amount = policy
						? yearly
							? policy.yearlyPriceMinor
							: policy.monthlyPriceMinor
						: null
					const extraSeat = policy
						? yearly
							? policy.additionalSeatYearlyPriceMinor
							: policy.additionalSeatMonthlyPriceMinor
						: null
					return (
						<article key={period} className={pricingStyles.planCard}>
							<h3 className={pricingStyles.planName}>
								WinCRM для команды
							</h3>
							<p className={pricingStyles.planSubtitle}>
								{yearly ? 'На год' : 'На месяц'}
							</p>
							<div className={pricingStyles.priceBlock}>
								<span className={pricingStyles.price}>
									{amount === null ? 'Скоро' : rubles.format(amount / 100)}
								</span>
								{amount !== null && (
									<span className={pricingStyles.pricePer}>
										/ {yearly ? 'год' : 'месяц'}
									</span>
								)}
							</div>
							<ul className={pricingStyles.features}>
								<li>Контакты, компании и история общения</li>
								<li>Воронки продаж, сделки и задачи</li>
								<li>Шаблоны процессов для разных типов бизнеса</li>
								{policy && (
									<li>
										Включено мест: {policy.includedSeats}, вместе с
										владельцем
									</li>
								)}
								{extraSeat !== null && (
									<li>
										Дополнительное место: {rubles.format(extraSeat / 100)}{' '}
										/ {yearly ? 'год' : 'месяц'}
									</li>
								)}
							</ul>
							{CRM_RELEASE.apiEnabled && CRM_RELEASE.billingEnabled ? (
								<Link
									href={`${getCrmAppUrl()}/settings`}
									className={pricingStyles.buyBtn}
									onClick={() => toast('Открываем оплату WinCRM')}
								>
									Открыть оплату WinCRM
								</Link>
							) : (
								<button
									type="button"
									className={pricingStyles.buyBtn}
									disabled
									title="Онлайн-оплата WinCRM пока недоступна"
								>
									{CRM_RELEASE.apiEnabled
										? 'Оплата скоро'
										: CRM_RELEASE.unavailableLabel}
								</button>
							)}
						</article>
					)
				})}
			</div>
			<p className={styles.footnote}>
				Бесплатный период — 5 дней, только после нажатия «Попробовать
				бесплатно».
				{policy &&
					` Доступно мест: ${policy.trialSeatLimit}, включая владельца.`}{' '}
				Подписки CRM и Widgets оплачиваются независимо. Виджеты не
				обязательны для работы в CRM; их можно подключить при действующей
				подписке Easy или Hard.
			</p>
		</div>
	)
}
