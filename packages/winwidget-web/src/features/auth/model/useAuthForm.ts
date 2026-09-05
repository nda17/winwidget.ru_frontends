import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { useRecaptchaV3 } from '@/features/auth/model/useRecaptchaV3'
import { useNavigationContext } from '@/shared/lib/navigation/NavigationProvider'
import authService, {
	IEmailRegistrationResponse,
	ITelegramAuthStartResponse
} from '@/features/auth/api/auth.api'
import { IFormData } from '@/features/auth/model/form.types'
import { validPhoneCode } from '@/shared/regex'
import { parsePhoneInput } from '@/shared/lib/phone'
import { useAuthStore } from '@/entities/user'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useZoneRouter as useRouter } from '@/shared/lib/navigation/useZoneRouter'
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useTransition
} from 'react'
import { SubmitHandler, useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import {
	clearAuthReturnIntent,
	getSafeAuthReturnUrl
} from '@/shared/lib/auth-return-url'

const PENDING_EMAIL_REGISTRATION_STORAGE_KEY = 'pendingEmailRegistration'
const AFFILIATE_REFERRER_STORAGE_KEY = 'affiliateReferrerId'
const TELEGRAM_AUTH_POLL_INTERVAL_MS = 2500
const TELEGRAM_AUTH_POLL_TIMEOUT_MS = 120000

type PendingEmailRegistrationState = {
	email: string
	expiresAt: string
	resendAvailableAt: string
}

const savePendingEmailRegistrationState = (
	payload: PendingEmailRegistrationState
) => {
	if (typeof window === 'undefined') {
		return
	}

	window.localStorage.setItem(
		PENDING_EMAIL_REGISTRATION_STORAGE_KEY,
		JSON.stringify(payload)
	)
}

const getPendingEmailRegistrationState = () => {
	if (typeof window === 'undefined') {
		return null
	}

	const rawValue = window.localStorage.getItem(
		PENDING_EMAIL_REGISTRATION_STORAGE_KEY
	)

	if (!rawValue) {
		return null
	}

	try {
		return JSON.parse(rawValue) as PendingEmailRegistrationState
	} catch {
		window.localStorage.removeItem(PENDING_EMAIL_REGISTRATION_STORAGE_KEY)
		return null
	}
}

const clearPendingEmailRegistrationState = () => {
	if (typeof window === 'undefined') {
		return
	}

	window.localStorage.removeItem(PENDING_EMAIL_REGISTRATION_STORAGE_KEY)
}

const getAffiliateReferrerId = () => {
	if (typeof window === 'undefined') {
		return undefined
	}

	return (
		window.localStorage.getItem(AFFILIATE_REFERRER_STORAGE_KEY)?.trim() ||
		undefined
	)
}

const clearAffiliateReferrerId = () => {
	if (typeof window === 'undefined') {
		return
	}

	window.localStorage.removeItem(AFFILIATE_REFERRER_STORAGE_KEY)
}

const useAuthForm = (
	isLogin: boolean,
	initialAuthMessage = '',
	authReturnUrl?: string | null
) => {
	const { previousRoute } = useNavigationContext()
	const setAuth = useAuthStore(state => state.setAuth)
	const setAuthResolved = useAuthStore(state => state.setAuthResolved)

	const whiteListRedirect = ['/']
	const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email')
	const [isPhoneCodeRequested, setIsPhoneCodeRequested] = useState(false)
	const [isEmailCodeRequested, setIsEmailCodeRequested] = useState(false)
	const [telegramRequest, setTelegramRequest] =
		useState<ITelegramAuthStartResponse | null>(null)
	const [isTelegramAuthPolling, setIsTelegramAuthPolling] = useState(false)
	const [authMessage, setAuthMessage] = useState(initialAuthMessage)

	const {
		register,
		handleSubmit,
		reset,
		formState,
		watch,
		setValue,
		resetField,
		control
	} = useForm<IFormData>({
		mode: 'onChange'
	})
	const router = useRouter()
	const [isPending, startTransition] = useTransition()
	const queryClient = useQueryClient()
	const {
		executeRecaptcha,
		isRecaptchaEnabled,
		isRecaptchaUnavailable,
		markRecaptchaUnavailable,
		retryRecaptcha
	} = useRecaptchaV3()
	const emailValue = watch('email')
	const phoneValue = watch('phone')
	const telegramAuthPollRef = useRef<ReturnType<
		typeof setInterval
	> | null>(null)
	const telegramAuthToastRef = useRef<string | null>(null)
	const loginDestination =
		previousRoute && whiteListRedirect.includes(previousRoute)
			? previousRoute
			: PUBLIC_PAGES.HOME

	const navigateAfterAuth = (fallback: string) => {
		const safeReturnUrl = getSafeAuthReturnUrl(authReturnUrl)

		if (typeof window !== 'undefined') {
			clearAuthReturnIntent(window.sessionStorage)

			if (safeReturnUrl) {
				window.location.replace(safeReturnUrl)
				return
			}
		}

		router.replace(fallback)
	}

	const clearEmailCodeStep = useCallback(() => {
		clearPendingEmailRegistrationState()
		setIsEmailCodeRequested(false)
		setValue('code', '')
	}, [setValue])

	const syncPendingEmailRegistrationState = (
		payload: IEmailRegistrationResponse
	) => {
		savePendingEmailRegistrationState(payload)
		setValue('email', payload.email)
		setValue('code', '')
		setIsEmailCodeRequested(true)
	}

	const handleEmailFlowError = (error: unknown, prefix: string) => {
		if (!axios.isAxiosError(error)) {
			return
		}

		const errorCode = error.response?.data?.code
		if (
			errorCode === 'email_code_not_found' ||
			errorCode === 'user_already_exists'
		) {
			clearEmailCodeStep()
		}

		toast.error(`${prefix}: ${error.response?.data?.message}`)
	}

	const handleLoginError = (error: unknown) => {
		if (
			axios.isAxiosError(error) &&
			error.response?.status === 503 &&
			error.response.data?.code === 'recaptcha_unavailable'
		) {
			markRecaptchaUnavailable()
		}
		const message = axios.isAxiosError(error)
			? error.response?.data?.message || 'Не удалось войти'
			: 'Не удалось войти'

		setAuthMessage(message)
		toast.error(`Ошибка входа: ${message}`)
	}

	const getErrorMessage = (error: unknown, fallback: string) => {
		if (axios.isAxiosError(error)) {
			return error.response?.data?.message || fallback
		}

		if (error instanceof Error) {
			return error.message
		}

		return fallback
	}

	const { mutate: mutateLogin, isPending: isLoginPending } = useMutation({
		mutationKey: ['login'],
		mutationFn: ({
			data,
			token
		}: {
			data: IFormData
			token: string | null
		}) => authService.main('login', data, token),
		onSuccess() {
			startTransition(() => {
				setAuth(true)
				setAuthResolved(true)
				toast.success('Успешный вход в аккаунт')
				reset()
				navigateAfterAuth(loginDestination)
				queryClient.invalidateQueries({ queryKey: ['get-profile'] })
			})
		},
		onError(error) {
			handleLoginError(error)
		}
	})

	const {
		mutate: mutateEmailSendCode,
		isPending: isEmailSendCodePending
	} = useMutation({
		mutationKey: ['email-send-code'],
		mutationFn: ({
			data,
			token
		}: {
			data: IFormData
			token: string | null
		}) =>
			authService.sendEmailCode(
				{
					email: data.email || '',
					password: data.password
				},
				token
			),
		onSuccess({ data }) {
			syncPendingEmailRegistrationState(data)
			toast.success('Код подтверждения отправлен на email')
		},
		onError(error) {
			handleEmailFlowError(error, 'Ошибка отправки кода')
		}
	})

	const {
		mutate: mutateEmailRegister,
		isPending: isEmailRegisterPending
	} = useMutation({
		mutationKey: ['email-register'],
		mutationFn: ({
			data,
			token
		}: {
			data: IFormData
			token: string | null
		}) =>
			authService.registerByEmail(
				{
					email: data.email || '',
					code: data.code,
					referrerId: getAffiliateReferrerId()
				},
				token
			),
		onSuccess() {
			startTransition(() => {
				clearEmailCodeStep()
				clearAffiliateReferrerId()
				setAuth(true)
				setAuthResolved(true)
				toast.success('Email подтвержден. Регистрация завершена')
				reset()
				navigateAfterAuth(PUBLIC_PAGES.CABINET)
				queryClient.invalidateQueries({ queryKey: ['get-profile'] })
			})
		},
		onError(error) {
			handleEmailFlowError(error, 'Ошибка подтверждения email')
		}
	})

	const {
		mutate: mutateEmailResendCode,
		isPending: isEmailResendCodePending
	} = useMutation({
		mutationKey: ['email-resend-code'],
		mutationFn: ({
			email,
			token
		}: {
			email: string
			token: string | null
		}) => authService.resendEmailCode({ email }, token),
		onSuccess({ data }) {
			syncPendingEmailRegistrationState(data)
			toast.success('Новый код подтверждения отправлен на email')
		},
		onError(error) {
			handleEmailFlowError(error, 'Ошибка повторной отправки')
		}
	})

	const {
		mutate: mutatePhoneSendCode,
		isPending: isPhoneSendCodePending
	} = useMutation({
		mutationKey: ['phone-send-code'],
		mutationFn: ({
			phone,
			token
		}: {
			phone: string
			token: string | null
		}) => authService.sendPhoneCode({ phone }, token),
		onSuccess() {
			setIsPhoneCodeRequested(true)
			toast.success('Код подтверждения отправлен по SMS')
		},
		onError(error) {
			if (axios.isAxiosError(error)) {
				toast.error(
					`Ошибка отправки кода: ${error.response?.data?.message}`
				)
			}
		}
	})

	const {
		mutate: mutatePhoneRegister,
		isPending: isPhoneRegisterPending
	} = useMutation({
		mutationKey: ['phone-register'],
		mutationFn: ({
			data,
			token
		}: {
			data: IFormData
			token: string | null
		}) =>
			authService.registerByPhone(
				{
					phone: data.phone || '',
					password: data.password,
					code: data.code,
					referrerId: getAffiliateReferrerId()
				},
				token
			),
		onSuccess() {
			startTransition(() => {
				setAuth(true)
				setAuthResolved(true)
				toast.success('Регистрация по номеру телефона прошла успешно')
				clearAffiliateReferrerId()
				reset()
				setIsPhoneCodeRequested(false)
				queryClient.invalidateQueries({ queryKey: ['get-profile'] })
				navigateAfterAuth(PUBLIC_PAGES.CABINET)
			})
		},
		onError(error) {
			if (axios.isAxiosError(error)) {
				toast.error(`Ошибка регистрации: ${error.response?.data?.message}`)
			}
		}
	})

	const { mutate: mutatePhoneLogin, isPending: isPhoneLoginPending } =
		useMutation({
			mutationKey: ['phone-login'],
			mutationFn: ({
				data,
				token
			}: {
				data: IFormData
				token: string | null
			}) =>
				authService.loginByPhone(
					{
						phone: data.phone || '',
						password: data.password
					},
					token
				),
			onSuccess() {
				startTransition(() => {
					setAuth(true)
					setAuthResolved(true)
					toast.success('Успешный вход в аккаунт')
					reset()
					navigateAfterAuth(loginDestination)
					queryClient.invalidateQueries({ queryKey: ['get-profile'] })
				})
			},
			onError(error) {
				handleLoginError(error)
			}
		})

	const {
		mutateAsync: startTelegramAuthAsync,
		isPending: isTelegramStartPending
	} = useMutation({
		mutationKey: ['telegram-auth-start'],
		mutationFn: (token: string | null) =>
			authService.startTelegramAuth(token)
	})

	const clearTelegramAuthPolling = (dismissToast = false) => {
		if (telegramAuthPollRef.current) {
			clearInterval(telegramAuthPollRef.current)
			telegramAuthPollRef.current = null
		}

		setIsTelegramAuthPolling(false)

		if (dismissToast && telegramAuthToastRef.current) {
			toast.remove(telegramAuthToastRef.current)
			telegramAuthToastRef.current = null
		}
	}

	const completeTelegramAuthFlow = (toastId?: string) => {
		clearTelegramAuthPolling()
		telegramAuthToastRef.current = null

		startTransition(() => {
			setTelegramRequest(null)
			setAuth(true)
			setAuthResolved(true)
			clearAffiliateReferrerId()
			toast.success('Успешный вход через Telegram', { id: toastId })
			reset()
			navigateAfterAuth(isLogin ? loginDestination : PUBLIC_PAGES.CABINET)
			queryClient.invalidateQueries({ queryKey: ['get-profile'] })
		})
	}

	const startTelegramAuthPolling = (
		requestId: string,
		toastId: string
	) => {
		clearTelegramAuthPolling(true)
		telegramAuthToastRef.current = toastId
		setIsTelegramAuthPolling(true)

		const startedAt = Date.now()

		telegramAuthPollRef.current = setInterval(async () => {
			try {
				const { data } = await authService.completeTelegramAuth({
					requestId,
					referrerId: getAffiliateReferrerId()
				})

				if (data.confirmed) {
					completeTelegramAuthFlow(toastId)
					return
				}

				if (Date.now() - startedAt >= TELEGRAM_AUTH_POLL_TIMEOUT_MS) {
					clearTelegramAuthPolling()
					telegramAuthToastRef.current = null
					setTelegramRequest(null)
					toast.error(
						'Не удалось подтвердить вход. Откройте Auth_bot ещё раз.',
						{ id: toastId }
					)
				}
			} catch (error) {
				if (Date.now() - startedAt >= TELEGRAM_AUTH_POLL_TIMEOUT_MS) {
					clearTelegramAuthPolling()
					telegramAuthToastRef.current = null
					setTelegramRequest(null)
					toast.error(
						`Telegram: ${getErrorMessage(error, 'Не удалось проверить статус входа')}`,
						{ id: toastId }
					)
				}
			}
		}, TELEGRAM_AUTH_POLL_INTERVAL_MS)
	}

	useEffect(() => {
		return () => {
			if (telegramAuthPollRef.current) {
				clearInterval(telegramAuthPollRef.current)
			}

			if (telegramAuthToastRef.current) {
				toast.dismiss(telegramAuthToastRef.current)
			}
		}
	}, [])

	useEffect(() => {
		setAuthMessage(initialAuthMessage)
	}, [initialAuthMessage])

	useEffect(() => {
		if (isLogin) {
			clearEmailCodeStep()
			setIsPhoneCodeRequested(false)
			setValue('code', '')
			resetField('phone')
			return
		}

		const pendingEmailRegistration = getPendingEmailRegistrationState()

		if (!pendingEmailRegistration) {
			return
		}

		if (
			new Date(pendingEmailRegistration.expiresAt).getTime() < Date.now()
		) {
			clearPendingEmailRegistrationState()
			return
		}

		setValue('email', pendingEmailRegistration.email)
		setValue('code', '')
		setIsEmailCodeRequested(true)
	}, [clearEmailCodeStep, isLogin, resetField, setValue])

	useEffect(() => {
		if (authMethod === 'phone') {
			clearEmailCodeStep()
			setValue('code', '')
			return
		}

		setIsPhoneCodeRequested(false)
		setValue('code', '')
		resetField('phone')
	}, [authMethod, clearEmailCodeStep, resetField, setValue])

	const onSubmit: SubmitHandler<IFormData> = async data => {
		setAuthMessage('')
		let token: string | null = null
		const recaptchaAction =
			authMethod === 'phone'
				? isLogin
					? 'phone_login'
					: isPhoneCodeRequested
						? 'phone_register'
						: 'phone_send_code'
				: isLogin
					? 'login'
					: isEmailCodeRequested
						? 'email_register'
						: 'register'

		try {
			token = await executeRecaptcha(recaptchaAction)
		} catch {
			toast.error('Не удалось пройти проверку капчи')
			return
		}

		if (isRecaptchaEnabled && !token) {
			toast.error('Не удалось пройти проверку капчи')
			return
		}

		if (authMethod === 'phone') {
			const phone = parsePhoneInput(data.phone || '')
			if (!phone) {
				toast.error('Введите корректный номер телефона')
				return
			}

			const phoneData = { ...data, phone }

			if (isLogin) {
				mutatePhoneLogin({ data: phoneData, token })
				return
			}

			if (!isPhoneCodeRequested) {
				mutatePhoneSendCode({
					phone,
					token
				})
				return
			}

			if (!data.code || !validPhoneCode.test(data.code)) {
				toast.error('Введите корректный код из SMS')
				return
			}

			mutatePhoneRegister({ data: phoneData, token })
			return
		}

		if (isLogin) {
			mutateLogin({ data, token })
			return
		}

		if (!isEmailCodeRequested) {
			mutateEmailSendCode({ data, token })
			return
		}

		if (!data.code || !validPhoneCode.test(data.code)) {
			toast.error('Введите корректный код из email')
			return
		}

		mutateEmailRegister({ data, token })
	}

	const resendEmailCode = async () => {
		const email = emailValue?.trim()

		if (!email) {
			toast.error('Введите email')
			return
		}

		let token: string | null = null

		try {
			token = await executeRecaptcha('email_resend_code')
		} catch {
			toast.error('Не удалось пройти проверку капчи')
			return
		}

		if (isRecaptchaEnabled && !token) {
			toast.error('Не удалось пройти проверку капчи')
			return
		}

		mutateEmailResendCode({ email, token })
	}

	const startTelegramAuth = async () => {
		setAuthMessage('')

		let telegramWindow: Window | null = null
		if (typeof window !== 'undefined') {
			telegramWindow = window.open('about:blank', '_blank')
		}

		const toastId = toast.loading('Готовим вход через Auth_bot...')

		try {
			const token = await executeRecaptcha('telegram_auth_start')

			if (isRecaptchaEnabled && !token) {
				throw new Error('Не удалось пройти проверку капчи')
			}

			const { data } = await startTelegramAuthAsync(token)
			setTelegramRequest(data)
			toast.loading('Ждём подтверждения в Auth_bot...', { id: toastId })
			startTelegramAuthPolling(data.requestId, toastId)

			if (telegramWindow) {
				telegramWindow.location.href = data.botUrl
			} else if (typeof window !== 'undefined') {
				window.open(data.botUrl, '_blank', 'noopener,noreferrer')
			}
		} catch (error) {
			telegramWindow?.close()
			clearTelegramAuthPolling()
			toast.error(
				`Telegram: ${getErrorMessage(error, 'Не удалось открыть Auth_bot')}`,
				{ id: toastId }
			)
		}
	}

	const cancelTelegramAuthStep = async () => {
		const requestId = telegramRequest?.requestId

		clearTelegramAuthPolling(true)
		setTelegramRequest(null)

		if (!requestId) return

		const toastId = toast.loading('Отменяем ожидание Telegram...')

		try {
			await authService.cancelTelegramAuth({ requestId })
			toast.success('Ожидание Telegram отменено', { id: toastId })
		} catch (error) {
			toast.error(
				`Telegram: ${getErrorMessage(error, 'Не удалось отменить ожидание')}`,
				{ id: toastId }
			)
		}
	}

	const isLoading =
		isPending ||
		isLoginPending ||
		isEmailSendCodePending ||
		isEmailRegisterPending ||
		isEmailResendCodePending ||
		isPhoneSendCodePending ||
		isPhoneRegisterPending ||
		isPhoneLoginPending ||
		isTelegramStartPending

	return {
		isRecaptchaUnavailable,
		retryRecaptcha,
		completeCodeLogin: () => {
			setAuth(true)
			setAuthResolved(true)
			reset()
			void queryClient.invalidateQueries({ queryKey: ['get-profile'] })
			navigateAfterAuth(loginDestination)
		},
		register,
		control,
		handleSubmit,
		onSubmit,
		isLoading,
		formState,
		authMethod,
		setAuthMethod,
		isPhoneCodeRequested,
		isEmailCodeRequested,
		emailValue,
		phoneValue,
		resendEmailCode,
		startTelegramAuth,
		isTelegramAuthLoading: isTelegramStartPending || isTelegramAuthPolling,
		isTelegramAuthRequested: Boolean(telegramRequest),
		telegramAuthUrl: telegramRequest?.botUrl ?? '',
		authMessage,
		resetEmailCodeStep: () => {
			clearEmailCodeStep()
		},
		resetPhoneCodeStep: () => {
			setIsPhoneCodeRequested(false)
			setValue('code', '')
		},
		resetTelegramAuthStep: cancelTelegramAuthStep
	}
}

export default useAuthForm
