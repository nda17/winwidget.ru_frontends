'use client'

import { useProfileIdentityBinding } from '@/features/bind-profile-identity'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import { useUser } from '@/entities/user'
import {
	subscriptionService,
	type IPendingPayment
} from '@/entities/subscription'
import type {
	HomePagePricingContent,
	HomePagePricingPlan
} from '@/entities/home-page-content'
import { tariffPricesService } from '@/entities/subscription'
import {
	createTariffPriceMap,
	type TariffPrice
} from '@/entities/subscription'
import type { BillingPeriod, Plan } from '@/entities/subscription'
import { validEmail, validPhoneCode } from '@/shared/regex'
import { useAuthStore } from '@/entities/user'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import {
	useMutation,
	useQuery,
	useQueryClient
} from '@tanstack/react-query'
import Link from '@/shared/lib/navigation/ZoneLink'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState
} from 'react'
import toast from 'react-hot-toast'
import styles from './Pricing.module.scss'
import CrmPricingCards from './CrmPricingCards'

const PLAN_PRIORITY: Record<Plan, number> = {
	TRIAL: 0,
	EASY: 1,
	HARD: 2
}

type PaidPlan = Extract<Plan, 'EASY' | 'HARD'>

const PLAN_COLORS: Record<PaidPlan, string> = {
	EASY: '#4705fb',
	HARD: '#7b2fff'
}

const PLAN_TITLE_FALLBACK: Record<Plan, string> = {
	TRIAL: 'Тест-драйв',
	EASY: 'Easy',
	HARD: 'Hard'
}

const BILLING_PERIOD_LABEL: Record<BillingPeriod, string> = {
	MONTHLY: 'месяц',
	YEARLY: 'год'
}

const PENDING_PAYMENT_FALLBACK_TTL_MS = 60 * 60 * 1000
const PENDING_PAYMENT_WARNING_MS = 5 * 60 * 1000

const PAYMENT_COPY = {
	title: 'Оплата',
	paymentDisabledNotice: 'Оплата временно недоступна. Попробуйте позже.',
	currentPlanText: 'Текущий тариф:',
	currentPlanUntilText: 'до',
	activeStatusText: 'Активен',
	expiredStatusText: 'Истек',
	pendingPaymentTitle: 'У вас есть незавершённый платёж',
	pendingPaymentUnavailableTitle: 'Этот платёж больше недоступен',
	pendingPaymentText:
		'Можно вернуться к оплате {payment} или отменить текущую попытку и создать новый платёж.',
	pendingPaymentUnavailableText:
		'У вас активен тариф {currentPlan}. Оплата более низкого тарифа {payment} недоступна до окончания текущей подписки. Можно отменить эту попытку.',
	pendingPaymentResumeButtonText: 'Вернуться к оплате',
	pendingPaymentCancelButtonText: 'Отменить платёж',
	pendingPaymentCancelLoadingText: 'Отменяем...',
	pendingPaymentTypeOneTime: 'Разовый платёж',
	pendingPaymentTypeAutoRenew: 'С автопродлением',
	pendingPaymentCountdownText: 'Ссылка на оплату действует ещё',
	pendingPaymentWarningText: 'До окончания оплаты осталось меньше 5 минут',
	pendingPaymentErrorTitle: 'Не удалось загрузить незавершённый платёж',
	pendingPaymentErrorText:
		'Обновите страницу перед созданием нового платежа.',
	paymentPopupBlockedText:
		'Браузер заблокировал новую вкладку. Разрешите всплывающие окна для WinWidget и повторите оплату.',
	authenticationRequiredText: 'Для оплаты войдите в аккаунт.',
	paymentOpenedInNewTabText: 'Страница оплаты открыта в новой вкладке',
	paymentCreatedWithoutOpenTabText:
		'Платёж создан. Вернуться к нему можно из карточки незавершённого платежа.',
	periodLegendText: 'Период оплаты',
	pricePerMonthText: '/мес',
	yearlyTotalText: '{amount} ₽ / год',
	unavailableButtonText: 'Недоступно',
	renewButtonText: 'Продлить',
	payButtonText: 'Оплатить',
	downgradeRestrictionText:
		'Понижение недоступно, пока активен {currentPlan}',
	paymentNote:
		'После оплаты подписка активируется автоматически. Оплата через ЮKassa.',
	contactRequiredTitle: 'Для оплаты подтвердите email',
	contactRequiredText:
		'Telegram не передаёт email или телефон. Для создания платежа ЮKassa нужен подтверждённый контакт в профиле.',
	contactRequiredPendingText:
		'После подтверждения email продолжим оплату тарифа {payment}.',
	contactRequiredAutoRenewText:
		'Выбранный режим: {paymentType}. Выбор сохранится после подтверждения email.',
	contactEmailPlaceholder: 'Email для оплаты',
	contactEmailCodePlaceholder: 'Код из email',
	contactEmailSendButtonText: 'Получить код',
	contactEmailResendButtonText: 'Отправить повторно',
	contactEmailVerifyButtonText: 'Подтвердить и оплатить',
	contactEmailResetButtonText: 'Изменить email',
	pendingPaymentNote:
		'Пока есть незавершённый платёж, создание нового платежа недоступно.',
	carryoverNote:
		'Оплачивать подписку можно сколько угодно раз — срок суммируется. При продлении текущего тарифа и переходе на более высокий оставшиеся дни переносятся на новый период.'
}

const formatRub = (value: number) =>
	new Intl.NumberFormat('ru-RU').format(value)

const isPaidPlan = (plan: string): plan is PaidPlan =>
	plan === 'EASY' || plan === 'HARD'

const isPaidPricingPlan = (
	plan: HomePagePricingPlan
): plan is HomePagePricingPlan & { key: PaidPlan } => isPaidPlan(plan.key)

const formatText = (
	template: string,
	values: Record<string, string>
): string =>
	Object.entries(values).reduce(
		(text, [key, value]) => text.split(`{${key}}`).join(value),
		template
	)

const renderTemplate = (
	template: string,
	values: Record<string, ReactNode>
): ReactNode[] => {
	const result: ReactNode[] = []
	const pattern = /\{([a-zA-Z0-9_]+)\}/g
	let lastIndex = 0
	let match: RegExpExecArray | null

	while ((match = pattern.exec(template)) !== null) {
		if (match.index > lastIndex) {
			result.push(template.slice(lastIndex, match.index))
		}

		const value = values[match[1]]
		result.push(value ?? match[0])
		lastIndex = pattern.lastIndex
	}

	if (lastIndex < template.length) {
		result.push(template.slice(lastIndex))
	}

	return result
}

const getPendingPaymentLabel = (
	pendingPayment: IPendingPayment,
	planLabel: Record<Plan, string>
) => {
	const paymentPlanLabel =
		pendingPayment.plan && planLabel[pendingPayment.plan]
			? planLabel[pendingPayment.plan]
			: 'выбранный тариф'

	const periodLabel = pendingPayment.billingPeriod
		? BILLING_PERIOD_LABEL[pendingPayment.billingPeriod]
		: 'период'

	return `${paymentPlanLabel} на ${periodLabel}`
}

const getPaymentTypeLabel = (autoRenew: boolean) =>
	autoRenew
		? PAYMENT_COPY.pendingPaymentTypeAutoRenew
		: PAYMENT_COPY.pendingPaymentTypeOneTime

const getPendingExpiresAt = (pendingPayment: IPendingPayment) => {
	const expiresAt = Date.parse(pendingPayment.expiresAt)

	if (Number.isFinite(expiresAt)) return expiresAt

	const createdAt = Date.parse(pendingPayment.createdAt)
	return Number.isFinite(createdAt)
		? createdAt + PENDING_PAYMENT_FALLBACK_TTL_MS
		: 0
}

const formatCountdown = (remainingMs: number) => {
	const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60

	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

type PendingPaymentRequest = {
	plan: PaidPlan
	billingPeriod: BillingPeriod
	expectedAmount: number
	autoRenew: boolean
}

type PaymentMutationRequest = PendingPaymentRequest & {
	paymentWindow: Window
}

const openPaymentWindow = (): Window | null => {
	if (typeof window === 'undefined') return null

	const paymentWindow = window.open('about:blank', '_blank')

	if (paymentWindow) {
		paymentWindow.opener = null
	}

	return paymentWindow
}

interface PricingProps {
	pricingContent: HomePagePricingContent
	paymentEnabled?: boolean
	autoRenewalSignupEnabled?: boolean
	autoRenewalTerms?: {
		version: string
		text: string
	} | null
	tariffPrices?: TariffPrice[] | null
}

const Pricing = ({
	pricingContent,
	paymentEnabled = true,
	autoRenewalSignupEnabled = false,
	autoRenewalTerms = null,
	tariffPrices = null
}: PricingProps) => {
	const auth = useAuthStore(state => state.auth)
	const router = useRouter()
	const queryClient = useQueryClient()
	const { user, isLoading: isUserLoading } = useUser()
	const [product, setProduct] = useState<'WIDGETS' | 'CRM'>('WIDGETS')
	const [period, setPeriod] = useState<BillingPeriod>('YEARLY')
	const [autoRenewByPlan, setAutoRenewByPlan] = useState<
		Record<PaidPlan, boolean>
	>({
		EASY: false,
		HARD: false
	})
	const [paymentEmail, setPaymentEmail] = useState('')
	const [paymentEmailCode, setPaymentEmailCode] = useState('')
	const [pendingPaymentRequest, setPendingPaymentRequest] =
		useState<PendingPaymentRequest | null>(null)
	const [nowMs, setNowMs] = useState<number | null>(null)
	const [serverOffsetMs, setServerOffsetMs] = useState(0)
	const [serverOffsetKey, setServerOffsetKey] = useState('')
	const expiredPaymentCheckIdRef = useRef<string | null>(null)
	const paymentStateRefreshInFlightRef = useRef(false)
	const {
		emailCodeRequested,
		isSendingEmailCode,
		isVerifyingEmailCode,
		requestEmailCode,
		confirmEmailCode,
		resetEmailBinding
	} = useProfileIdentityBinding()

	const { data: actualTariffPrices = tariffPrices } = useQuery({
		queryKey: ['tariff-prices'],
		queryFn: tariffPricesService.get,
		initialData: tariffPrices ?? undefined
	})
	const tariffPriceMap = createTariffPriceMap(actualTariffPrices)
	const paidPlans = pricingContent.plans.filter(isPaidPricingPlan)
	const planLabel: Record<Plan, string> = {
		TRIAL: PLAN_TITLE_FALLBACK.TRIAL,
		EASY:
			paidPlans.find(plan => plan.key === 'EASY')?.title ??
			PLAN_TITLE_FALLBACK.EASY,
		HARD:
			paidPlans.find(plan => plan.key === 'HARD')?.title ??
			PLAN_TITLE_FALLBACK.HARD
	}

	const { data: subscription, isLoading: subLoading } = useQuery({
		queryKey: ['subscription'],
		queryFn: subscriptionService.getMySubscription,
		enabled: auth
	})

	const {
		data: pendingPayment,
		isLoading: pendingLoading,
		isError: pendingLoadError
	} = useQuery({
		queryKey: ['pending-payment'],
		queryFn: subscriptionService.getPendingPayment,
		enabled: auth
	})

	const payMutation = useMutation({
		mutationFn: ({
			plan,
			billingPeriod,
			expectedAmount,
			autoRenew
		}: PaymentMutationRequest) =>
			subscriptionService.createPayment(
				plan,
				billingPeriod,
				expectedAmount,
				autoRenew,
				autoRenew ? autoRenewalTerms?.version : undefined
			),
		onMutate: () =>
			toast.loading('Создаём платёж, пожалуйста подождите...'),
		onSuccess: async ({ confirmationUrl }, { paymentWindow }, toastId) => {
			const isPaymentWindowOpen = !paymentWindow.closed

			if (isPaymentWindowOpen) {
				paymentWindow.location.replace(confirmationUrl)
			}

			await queryClient.invalidateQueries({
				queryKey: ['pending-payment']
			})

			toast.success(
				isPaymentWindowOpen
					? PAYMENT_COPY.paymentOpenedInNewTabText
					: PAYMENT_COPY.paymentCreatedWithoutOpenTabText,
				{ id: toastId }
			)
		},
		onError: (e: any, { paymentWindow }, toastId) => {
			paymentWindow.close()
			toast.error(e?.response?.data?.message || 'Ошибка оплаты', {
				id: toastId
			})
		}
	})

	const startPayment = (
		request: PendingPaymentRequest,
		paymentWindow = openPaymentWindow()
	) => {
		if (!paymentWindow) {
			toast.error(PAYMENT_COPY.paymentPopupBlockedText)
			return
		}

		payMutation.mutate({
			...request,
			paymentWindow
		})
	}

	const cancelPendingMutation = useMutation({
		mutationFn: (paymentId: string) =>
			subscriptionService.cancelPendingPayment(paymentId),
		onMutate: async paymentId => {
			const toastId = `pending-payment-cancel-${paymentId}`
			toast.loading('Отменяем незавершённый платёж...', {
				id: toastId
			})
			await queryClient.cancelQueries({ queryKey: ['pending-payment'] })
			return toastId
		},
		onSuccess: (result, paymentId, toastId) => {
			queryClient.setQueryData<IPendingPayment | null>(
				['pending-payment'],
				currentPayment =>
					currentPayment?.id === paymentId ? null : currentPayment
			)
			void Promise.all([
				queryClient.invalidateQueries({ queryKey: ['subscription'] }),
				queryClient.invalidateQueries({ queryKey: ['payment-history'] }),
				queryClient.invalidateQueries({ queryKey: ['auto-renewal'] }),
				queryClient.invalidateQueries({ queryKey: ['widgets'] })
			])
			toast.success(result.message, {
				id: toastId
			})
		},
		onError: (e: any, paymentId, toastId) => {
			void Promise.all([
				queryClient.invalidateQueries({ queryKey: ['pending-payment'] }),
				queryClient.invalidateQueries({ queryKey: ['subscription'] }),
				queryClient.invalidateQueries({ queryKey: ['payment-history'] }),
				queryClient.invalidateQueries({ queryKey: ['auto-renewal'] }),
				queryClient.invalidateQueries({ queryKey: ['widgets'] })
			])
			toast.error(
				e?.response?.data?.message || 'Не удалось отменить платёж',
				{
					id: toastId ?? `pending-payment-cancel-${paymentId}`
				}
			)
		}
	})

	const isYearly = period === 'YEARLY'

	const currentPlan = subscription?.plan
	const currentPeriod = subscription?.billingPeriod
	const isActive = subscription?.status === 'ACTIVE'
	const activePendingPayment = pendingPayment ?? null
	const activePendingPaymentId = activePendingPayment?.id ?? null
	const hasPendingPayment = Boolean(activePendingPayment)
	const pendingPaymentLabel = activePendingPayment
		? getPendingPaymentLabel(activePendingPayment, planLabel)
		: null
	const currentPlanLabel = currentPlan ? planLabel[currentPlan] : null
	const isPendingDowngradeBlocked = Boolean(
		hasPendingPayment &&
		isActive &&
		currentPlan &&
		activePendingPayment?.plan &&
		PLAN_PRIORITY[currentPlan] > PLAN_PRIORITY[activePendingPayment.plan]
	)
	const isActionsDisabled =
		!paymentEnabled ||
		payMutation.isPending ||
		cancelPendingMutation.isPending ||
		pendingLoading ||
		pendingLoadError ||
		isUserLoading
	const hasPaymentContact = Boolean(user?.email || user?.phone)
	const shouldShowPaymentContactPrompt = Boolean(
		auth && user?.id && !hasPaymentContact
	)
	const pendingExpiresAtMs = activePendingPayment
		? getPendingExpiresAt(activePendingPayment)
		: 0
	const pendingServerTimeMs = activePendingPayment
		? Date.parse(activePendingPayment.serverTime)
		: Number.NaN
	const pendingServerOffsetKey = activePendingPayment
		? `${activePendingPayment.id}:${activePendingPayment.serverTime}`
		: ''
	const pendingServerNowMs =
		nowMs !== null && serverOffsetKey === pendingServerOffsetKey
			? nowMs + serverOffsetMs
			: Number.isFinite(pendingServerTimeMs)
				? pendingServerTimeMs
				: (nowMs ?? 0)
	const pendingRemainingMs = activePendingPayment
		? Math.max(0, pendingExpiresAtMs - pendingServerNowMs)
		: 0
	const isPendingPaymentWarning =
		nowMs !== null && pendingRemainingMs <= PENDING_PAYMENT_WARNING_MS
	const isPendingLinkAvailable = Boolean(
		activePendingPayment?.confirmationUrl &&
		!pendingLoadError &&
		pendingRemainingMs > 0
	)

	const refreshPaymentState = useCallback(async () => {
		if (paymentStateRefreshInFlightRef.current) return

		paymentStateRefreshInFlightRef.current = true

		try {
			await queryClient.invalidateQueries({
				queryKey: ['pending-payment']
			})
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['subscription'] }),
				queryClient.invalidateQueries({ queryKey: ['payment-history'] }),
				queryClient.invalidateQueries({ queryKey: ['auto-renewal'] }),
				queryClient.invalidateQueries({ queryKey: ['widgets'] })
			])
		} finally {
			paymentStateRefreshInFlightRef.current = false
		}
	}, [queryClient])

	const resolveExpiredPayment = useCallback(async () => {
		const payment = activePendingPayment

		if (!payment || expiredPaymentCheckIdRef.current === payment.id) {
			return
		}

		expiredPaymentCheckIdRef.current = payment.id
		queryClient.setQueryData<IPendingPayment | null>(
			['pending-payment'],
			currentPayment =>
				currentPayment?.id === payment.id ? null : currentPayment
		)

		try {
			const freshPayment = await subscriptionService.getPendingPayment()

			if (freshPayment && freshPayment.id !== payment.id) {
				queryClient.setQueryData(['pending-payment'], freshPayment)
			}

			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['subscription'] }),
				queryClient.invalidateQueries({ queryKey: ['payment-history'] }),
				queryClient.invalidateQueries({ queryKey: ['auto-renewal'] }),
				queryClient.invalidateQueries({ queryKey: ['widgets'] })
			])
		} catch {
			// The expired checkout stays hidden. The backend cleanup and the
			// next payment request repeat the same idempotent expiration check.
		}
	}, [activePendingPayment, queryClient])

	useEffect(() => {
		if (!activePendingPayment) return

		const serverTime = Date.parse(activePendingPayment.serverTime)
		setServerOffsetMs(
			Number.isFinite(serverTime) ? serverTime - Date.now() : 0
		)
		setServerOffsetKey(
			`${activePendingPayment.id}:${activePendingPayment.serverTime}`
		)
		setNowMs(Date.now())
	}, [activePendingPayment])

	useEffect(() => {
		if (!activePendingPaymentId || pendingRemainingMs > 0) {
			expiredPaymentCheckIdRef.current = null
		}
	}, [activePendingPaymentId, pendingRemainingMs])

	useEffect(() => {
		if (!activePendingPayment) return

		const updateClock = () => setNowMs(Date.now())
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				updateClock()
				void refreshPaymentState()
			}
		}
		const handleWindowFocus = () => {
			updateClock()
			void refreshPaymentState()
		}
		const intervalId = window.setInterval(updateClock, 1000)

		window.addEventListener('focus', handleWindowFocus)
		document.addEventListener('visibilitychange', handleVisibilityChange)

		return () => {
			window.clearInterval(intervalId)
			window.removeEventListener('focus', handleWindowFocus)
			document.removeEventListener(
				'visibilitychange',
				handleVisibilityChange
			)
		}
	}, [activePendingPayment, refreshPaymentState])

	useEffect(() => {
		if (activePendingPayment && pendingRemainingMs <= 0) {
			void resolveExpiredPayment()
		}
	}, [activePendingPayment, pendingRemainingMs, resolveExpiredPayment])

	const handlePaymentClick = (
		plan: PaidPlan,
		billingPeriod: BillingPeriod,
		expectedAmount: number,
		autoRenew: boolean
	) => {
		if (!auth) {
			toast.error(PAYMENT_COPY.authenticationRequiredText)
			router.push(PUBLIC_PAGES.LOGIN)
			return
		}

		if (shouldShowPaymentContactPrompt) {
			setPendingPaymentRequest({
				plan,
				billingPeriod,
				expectedAmount,
				autoRenew
			})
			toast.error('Для оплаты сначала подтвердите email')
			return
		}

		startPayment({
			plan,
			billingPeriod,
			expectedAmount,
			autoRenew
		})
	}

	const handlePeriodChange = (billingPeriod: BillingPeriod) => {
		setPeriod(billingPeriod)
		setPendingPaymentRequest(current =>
			current
				? {
						...current,
						billingPeriod,
						expectedAmount: tariffPriceMap[current.plan][billingPeriod]
					}
				: current
		)
	}

	const handleAutoRenewChange = (plan: PaidPlan, autoRenew: boolean) => {
		setAutoRenewByPlan(current => ({ ...current, [plan]: autoRenew }))
		setPendingPaymentRequest(current =>
			current?.plan === plan ? { ...current, autoRenew } : current
		)
		toast.success(
			autoRenew
				? 'Для следующего платежа выбрано автопродление'
				: 'Следующий платёж будет разовым',
			{ id: `auto-renew-choice-${plan}` }
		)
	}

	const requestPaymentEmailCode = async () => {
		const email = paymentEmail.trim()

		if (!validEmail.test(email)) {
			toast.error('Введите корректный email')
			return
		}

		const sent = await requestEmailCode(email)
		if (sent) setPaymentEmail(email)
	}

	const confirmPaymentEmailCode = async () => {
		const email = paymentEmail.trim()
		const code = paymentEmailCode.trim()

		if (!validEmail.test(email)) {
			toast.error('Введите корректный email')
			return
		}

		if (!validPhoneCode.test(code)) {
			toast.error('Введите корректный код из email')
			return
		}

		const paymentWindow = openPaymentWindow()

		if (!paymentWindow) {
			toast.error(PAYMENT_COPY.paymentPopupBlockedText)
			return
		}

		const confirmed = await confirmEmailCode({ email, code })
		if (!confirmed) {
			paymentWindow.close()
			return
		}

		const nextPayment = pendingPaymentRequest
		setPaymentEmail('')
		setPaymentEmailCode('')
		setPendingPaymentRequest(null)
		resetEmailBinding()

		if (nextPayment) {
			startPayment(nextPayment, paymentWindow)
		} else {
			paymentWindow.close()
		}
	}

	return (
		<section className={styles.page} aria-labelledby="pricing-page-title">
			<h1 id="pricing-page-title" className={styles.title}>
				{PAYMENT_COPY.title}
			</h1>

			<fieldset className={styles.productGroup}>
				<legend className={styles.productLegend}>Выберите продукт</legend>
				<div className={styles.productToggle}>
					{(['WIDGETS', 'CRM'] as const).map(value => (
						<label key={value} className={styles.productOption}>
							<input
								type="radio"
								name="payment-product"
								value={value}
								checked={product === value}
								aria-controls={`payment-product-${value}`}
								onChange={() => {
									setProduct(value)
									toast(
										value === 'CRM' ? 'Тарифы WinCRM' : 'Тарифы виджетов'
									)
								}}
							/>
							<span>{value === 'CRM' ? 'CRM' : 'Виджеты'}</span>
						</label>
					))}
				</div>
			</fieldset>
			{product === 'CRM' ? (
				<div id="payment-product-CRM" className={styles.productPanel}>
					<CrmPricingCards />
				</div>
			) : (
				<div id="payment-product-WIDGETS" className={styles.productPanel}>
					{!paymentEnabled && (
						<div className={styles.paymentDisabledNotice}>
							{PAYMENT_COPY.paymentDisabledNotice}
						</div>
					)}

					{auth && subLoading ? (
						<div className={styles.currentPlan} aria-hidden="true">
							<SkeletonLoader
								height={18}
								width={220}
								containerClassName={styles.currentPlanSkeletonLine}
							/>
							<SkeletonLoader
								height={18}
								width={90}
								containerClassName={styles.currentPlanSkeletonLine}
							/>
							<SkeletonLoader
								height={24}
								width={74}
								borderRadius={999}
								containerClassName={styles.currentPlanSkeletonBadge}
							/>
						</div>
					) : subscription ? (
						<div className={styles.currentPlan}>
							<span>
								{PAYMENT_COPY.currentPlanText}{' '}
								<strong>{planLabel[subscription.plan]}</strong>
							</span>
							{subscription.expiresAt && (
								<span>
									{PAYMENT_COPY.currentPlanUntilText}{' '}
									{new Date(subscription.expiresAt).toLocaleDateString(
										'ru-RU'
									)}
								</span>
							)}
							<span
								className={
									isActive ? styles.statusActive : styles.statusExpired
								}
							>
								{isActive
									? PAYMENT_COPY.activeStatusText
									: PAYMENT_COPY.expiredStatusText}
							</span>
						</div>
					) : null}

					{auth && pendingLoading ? (
						<div
							className={`${styles.pendingNotice} ${styles.pendingNoticeSkeleton}`}
							aria-hidden="true"
						>
							<div className={styles.pendingCopy}>
								<SkeletonLoader
									height={16}
									width={210}
									containerClassName={styles.pendingSkeletonLine}
								/>
								<SkeletonLoader
									height={14}
									width={280}
									containerClassName={styles.pendingSkeletonLine}
								/>
							</div>
							<div className={styles.pendingSkeletonActions}>
								<SkeletonLoader
									height={40}
									width={170}
									borderRadius={14}
									containerClassName={styles.pendingSkeletonButton}
								/>
							</div>
						</div>
					) : pendingLoadError && !hasPendingPayment ? (
						<div
							className={`${styles.pendingNotice} ${styles.pendingNoticeError}`}
							role="alert"
						>
							<div className={styles.pendingCopy}>
								<p className={styles.pendingTitle}>
									{PAYMENT_COPY.pendingPaymentErrorTitle}
								</p>
								<p className={styles.pendingText}>
									{PAYMENT_COPY.pendingPaymentErrorText}
								</p>
							</div>
						</div>
					) : hasPendingPayment ? (
						<div
							className={`${styles.pendingNotice} ${
								isPendingPaymentWarning ? styles.pendingNoticeWarning : ''
							}`}
						>
							<div className={styles.pendingCopy}>
								<p className={styles.pendingTitle}>
									{isPendingDowngradeBlocked
										? PAYMENT_COPY.pendingPaymentUnavailableTitle
										: PAYMENT_COPY.pendingPaymentTitle}
								</p>
								<p className={styles.pendingText}>
									{isPendingDowngradeBlocked ? (
										<>
											{renderTemplate(
												PAYMENT_COPY.pendingPaymentUnavailableText,
												{
													currentPlan: (
														<strong key="currentPlan">
															{currentPlanLabel}
														</strong>
													),
													payment: (
														<strong key="payment">
															{pendingPaymentLabel}
														</strong>
													)
												}
											)}
										</>
									) : (
										<>
											{renderTemplate(PAYMENT_COPY.pendingPaymentText, {
												payment: (
													<strong key="payment">
														{pendingPaymentLabel}
													</strong>
												)
											})}
										</>
									)}
								</p>
								<div className={styles.pendingMeta}>
									<span className={styles.pendingTypeBadge}>
										{getPaymentTypeLabel(
											Boolean(activePendingPayment?.autoRenew)
										)}
									</span>
									<span
										className={`${styles.pendingCountdown} ${
											isPendingPaymentWarning
												? styles.pendingCountdownWarning
												: ''
										}`}
									>
										<span>
											{PAYMENT_COPY.pendingPaymentCountdownText}{' '}
										</span>
										<strong aria-hidden="true">
											{nowMs === null
												? '--:--'
												: formatCountdown(pendingRemainingMs)}
										</strong>
										<span className="srOnly">
											{nowMs === null
												? 'Оставшееся время рассчитывается'
												: `${Math.max(1, Math.ceil(pendingRemainingMs / 60000))} мин.`}
										</span>
									</span>
								</div>
								{isPendingPaymentWarning && (
									<p className={styles.pendingWarning} role="status">
										{PAYMENT_COPY.pendingPaymentWarningText}
									</p>
								)}
							</div>
							<div className={styles.pendingActions}>
								{!isPendingDowngradeBlocked && isPendingLinkAvailable && (
									<a
										href={
											activePendingPayment?.confirmationUrl ?? undefined
										}
										target="_blank"
										rel="noopener noreferrer"
										className={styles.pendingResumeBtn}
										onClick={() =>
											toast.success(
												PAYMENT_COPY.paymentOpenedInNewTabText,
												{
													id: `pending-payment-open-${activePendingPaymentId}`
												}
											)
										}
									>
										{PAYMENT_COPY.pendingPaymentResumeButtonText}
									</a>
								)}
								<button
									type="button"
									className={styles.pendingCancelBtn}
									onClick={() => {
										if (activePendingPaymentId) {
											cancelPendingMutation.mutate(activePendingPaymentId)
										}
									}}
									disabled={cancelPendingMutation.isPending}
								>
									{cancelPendingMutation.isPending
										? PAYMENT_COPY.pendingPaymentCancelLoadingText
										: PAYMENT_COPY.pendingPaymentCancelButtonText}
								</button>
							</div>
						</div>
					) : null}

					{shouldShowPaymentContactPrompt && (
						<div className={styles.contactRequiredNotice}>
							<div className={styles.contactRequiredCopy}>
								<p className={styles.contactRequiredTitle}>
									{PAYMENT_COPY.contactRequiredTitle}
								</p>
								<p className={styles.contactRequiredText}>
									{PAYMENT_COPY.contactRequiredText}
								</p>
								{pendingPaymentRequest && (
									<>
										<p className={styles.contactRequiredText}>
											{renderTemplate(
												PAYMENT_COPY.contactRequiredPendingText,
												{
													payment: (
														<strong key="payment">
															{`${planLabel[pendingPaymentRequest.plan]} на ${BILLING_PERIOD_LABEL[pendingPaymentRequest.billingPeriod]}`}
														</strong>
													)
												}
											)}
										</p>
										<p className={styles.contactRequiredText}>
											{renderTemplate(
												PAYMENT_COPY.contactRequiredAutoRenewText,
												{
													paymentType: (
														<strong key="paymentType">
															{getPaymentTypeLabel(
																pendingPaymentRequest.autoRenew
															)}
														</strong>
													)
												}
											)}
										</p>
									</>
								)}
							</div>
							<div className={styles.contactRequiredForm}>
								<input
									className={styles.contactInput}
									value={paymentEmail}
									onChange={event => setPaymentEmail(event.target.value)}
									placeholder={PAYMENT_COPY.contactEmailPlaceholder}
									type="email"
									disabled={emailCodeRequested || isSendingEmailCode}
								/>
								<button
									type="button"
									className={styles.contactBtn}
									onClick={requestPaymentEmailCode}
									disabled={isSendingEmailCode || isVerifyingEmailCode}
								>
									{isSendingEmailCode
										? 'Отправляем...'
										: emailCodeRequested
											? PAYMENT_COPY.contactEmailResendButtonText
											: PAYMENT_COPY.contactEmailSendButtonText}
								</button>
							</div>
							{emailCodeRequested && (
								<div className={styles.contactRequiredForm}>
									<input
										className={styles.contactInput}
										value={paymentEmailCode}
										onChange={event =>
											setPaymentEmailCode(
												event.target.value.replace(/\D/g, '').slice(0, 6)
											)
										}
										placeholder={PAYMENT_COPY.contactEmailCodePlaceholder}
										inputMode="numeric"
										disabled={isVerifyingEmailCode}
									/>
									<button
										type="button"
										className={styles.contactBtn}
										onClick={confirmPaymentEmailCode}
										disabled={isSendingEmailCode || isVerifyingEmailCode}
									>
										{isVerifyingEmailCode
											? 'Проверяем...'
											: PAYMENT_COPY.contactEmailVerifyButtonText}
									</button>
									<button
										type="button"
										className={styles.contactSecondaryBtn}
										onClick={() => {
											resetEmailBinding()
											setPaymentEmailCode('')
										}}
										disabled={isSendingEmailCode || isVerifyingEmailCode}
									>
										{PAYMENT_COPY.contactEmailResetButtonText}
									</button>
								</div>
							)}
						</div>
					)}

					{/* Period toggle */}
					<fieldset className={styles.periodGroup}>
						<legend className="srOnly">
							{PAYMENT_COPY.periodLegendText}
						</legend>
						<div className={styles.periodToggle}>
							<button
								type="button"
								className={`${styles.periodBtn} ${!isYearly ? styles.periodActive : ''}`}
								onClick={() => handlePeriodChange('MONTHLY')}
							>
								{pricingContent.monthlyToggleText}
							</button>
							<button
								type="button"
								className={`${styles.periodBtn} ${isYearly ? styles.periodActive : ''}`}
								onClick={() => handlePeriodChange('YEARLY')}
							>
								{pricingContent.yearlyToggleText}
								{pricingContent.discountText && (
									<span className={styles.discount}>
										{pricingContent.discountText}
									</span>
								)}
							</button>
						</div>
					</fieldset>

					<div className={styles.plans}>
						{paidPlans.map(plan => {
							const planPrices = tariffPriceMap[plan.key]
							const price = isYearly
								? Math.round(planPrices.YEARLY / 12)
								: planPrices.MONTHLY
							const paymentTotal = isYearly
								? planPrices.YEARLY
								: planPrices.MONTHLY
							const autoRenew = autoRenewByPlan[plan.key]
							const isDowngradeBlocked = Boolean(
								isActive &&
								currentPlan &&
								PLAN_PRIORITY[currentPlan] > PLAN_PRIORITY[plan.key]
							)
							const isCurrentPlan =
								currentPlan === plan.key &&
								(!currentPeriod || currentPeriod === period) &&
								isActive
							const titleId = `plan-${plan.key.toLowerCase()}-title`
							const autoRenewInputId = `plan-${plan.key.toLowerCase()}-auto-renew`
							const autoRenewDescriptionId = `plan-${plan.key.toLowerCase()}-auto-renew-description`

							return (
								<article
									key={plan.key}
									className={styles.planCard}
									aria-labelledby={titleId}
								>
									<h2
										id={titleId}
										className={styles.planName}
										style={{ color: PLAN_COLORS[plan.key] }}
									>
										{plan.title}
									</h2>
									{plan.subtitle && (
										<p className={styles.planSubtitle}>{plan.subtitle}</p>
									)}

									<div className={styles.priceBlock}>
										<span className={styles.price}>
											{formatRub(price)} ₽
										</span>
										<span className={styles.pricePer}>
											{PAYMENT_COPY.pricePerMonthText}
										</span>
									</div>

									{isYearly && (
										<p className={styles.yearlyNote}>
											{formatText(PAYMENT_COPY.yearlyTotalText, {
												amount: formatRub(planPrices.YEARLY)
											})}
										</p>
									)}

									<ul className={styles.features}>
										{plan.features.map(feature => (
											<li key={feature}>{feature}</li>
										))}
									</ul>

									<div className={styles.autoRenewBlock}>
										<label
											className={styles.autoRenewOption}
											htmlFor={autoRenewInputId}
											aria-label={`Автопродление: ${formatRub(paymentTotal)} ₽ ${
												isYearly ? 'раз в год' : 'каждый месяц'
											}`}
										>
											<input
												id={autoRenewInputId}
												type="checkbox"
												className={styles.autoRenewInput}
												checked={autoRenew}
												onChange={event =>
													handleAutoRenewChange(
														plan.key,
														event.target.checked
													)
												}
												disabled={
													!autoRenewalSignupEnabled ||
													!autoRenewalTerms ||
													isActionsDisabled ||
													hasPendingPayment ||
													isDowngradeBlocked
												}
												aria-describedby={autoRenewDescriptionId}
											/>
											<span
												className={styles.autoRenewVisual}
												aria-hidden="true"
											>
												<span>✓</span>
											</span>
											<span className={styles.autoRenewCopy}>
												<strong>
													{autoRenewalSignupEnabled
														? 'Автопродление'
														: 'Автопродление временно недоступно'}
												</strong>
												<span>
													{`${formatRub(paymentTotal)} ₽ ${
														isYearly ? 'раз в год' : 'каждый месяц'
													}`}
												</span>
											</span>
										</label>
										<p
											id={autoRenewDescriptionId}
											className={styles.autoRenewSummary}
										>
											{autoRenewalSignupEnabled && autoRenewalTerms
												? 'Сохраним способ оплаты в ЮKassa. Отключить автопродление можно в личном кабинете.'
												: 'Разовая оплата по выбранному тарифу доступна.'}
										</p>
										{autoRenewalSignupEnabled && autoRenewalTerms && (
											<details className={styles.autoRenewDetails}>
												<summary>Все условия автопродления</summary>
												<div className={styles.autoRenewDetailsContent}>
													<p className={styles.autoRenewDescription}>
														{autoRenewalTerms.text}
													</p>
													<Link href="/legal-documentation/oferta">
														Открыть договор-оферту
													</Link>
												</div>
											</details>
										)}
									</div>

									<button
										type="button"
										className={styles.buyBtn}
										style={{ background: PLAN_COLORS[plan.key] }}
										disabled={
											isActionsDisabled ||
											hasPendingPayment ||
											isDowngradeBlocked
										}
										onClick={() =>
											handlePaymentClick(
												plan.key,
												period,
												paymentTotal,
												autoRenew
											)
										}
									>
										{isDowngradeBlocked
											? PAYMENT_COPY.unavailableButtonText
											: isCurrentPlan
												? PAYMENT_COPY.renewButtonText
												: PAYMENT_COPY.payButtonText}
									</button>

									{isDowngradeBlocked && currentPlanLabel && (
										<p className={styles.planRestriction}>
											{renderTemplate(
												PAYMENT_COPY.downgradeRestrictionText,
												{
													currentPlan: (
														<strong key="currentPlan">
															{currentPlanLabel}
														</strong>
													)
												}
											)}
										</p>
									)}
								</article>
							)
						})}
					</div>

					{PAYMENT_COPY.paymentNote && (
						<p className={styles.note}>{PAYMENT_COPY.paymentNote}</p>
					)}

					{hasPendingPayment && PAYMENT_COPY.pendingPaymentNote && (
						<p className={styles.notePending}>
							{PAYMENT_COPY.pendingPaymentNote}
						</p>
					)}

					{isActive &&
						currentPlan !== 'TRIAL' &&
						PAYMENT_COPY.carryoverNote && (
							<p className={styles.noteCarryover}>
								{PAYMENT_COPY.carryoverNote}
							</p>
						)}
				</div>
			)}
		</section>
	)
}

export default Pricing
