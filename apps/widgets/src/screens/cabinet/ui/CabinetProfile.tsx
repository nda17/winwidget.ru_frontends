'use client'

import { useProfileIdentityBinding } from '@/features/bind-profile-identity'
import { useProfileEdit } from '@/features/edit-profile'
import { FieldUploadFile } from '@/features/upload-file'
import AppIcon from '@/shared/ui/icons/AppIcon'
import { usePhoneMask } from '@/shared/lib/hooks/usePhoneMask'
import { useUser } from '@/entities/user'
import { userService, IProfileEditInput } from '@/entities/user'
import {
	validEmail,
	validName,
	validPassword,
	validPhone,
	validPhoneCode
} from '@/shared/regex'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import styles from './Cabinet.module.scss'

type EmailBindingForm = { email: string; code: string }
type PhoneBindingForm = { phone: string; code: string }
type ProfileEditForm = IProfileEditInput & {
	avatarPreview?: string | null
}

const DEFAULT_AVATAR = '/avatar-default.png'
const TELEGRAM_STATUS_POLL_INTERVAL_MS = 2500
const TELEGRAM_STATUS_POLL_TIMEOUT_MS = 120000

const CabinetProfile = () => {
	const { user } = useUser()
	const queryClient = useQueryClient()
	const { onSubmit, isLoading: isSaving } = useProfileEdit()
	const hasPaymentContact = Boolean(user?.email || user?.phone)
	const hasTelegram = Boolean(user?.loginMethods?.includes('TELEGRAM'))
	const hasOtherLoginMethod = Boolean(
		user?.loginMethods?.some(method => method !== 'TELEGRAM')
	)
	const shouldShowPaymentContactNotice = Boolean(
		user && hasTelegram && !hasPaymentContact
	)
	const [telegramBindingUrl, setTelegramBindingUrl] = useState('')
	const [telegramNotificationsUrl, setTelegramNotificationsUrl] =
		useState('')
	const [
		telegramNotificationsRequestId,
		setTelegramNotificationsRequestId
	] = useState('')
	const telegramBindingPollRef = useRef<ReturnType<
		typeof setInterval
	> | null>(null)
	const telegramNotificationsPollRef = useRef<ReturnType<
		typeof setInterval
	> | null>(null)
	const telegramBindingToastRef = useRef<string | null>(null)
	const telegramNotificationsToastRef = useRef<string | null>(null)
	const [isProfilePasswordVisible, setIsProfilePasswordVisible] =
		useState(false)
	const { data: telegramNotifications } = useQuery({
		queryKey: ['profile-telegram-notifications'],
		queryFn: () => userService.fetchProfileTelegramNotifications(),
		enabled: Boolean(user)
	})
	const hasTelegramNotifications = Boolean(
		telegramNotifications?.connected
	)
	const pendingTelegramNotificationsRequest =
		telegramNotifications?.pendingRequest ?? null
	const isTelegramNotificationsConfigured = telegramNotifications
		? Boolean(
				telegramNotifications.telegramBotTokenConfigured &&
				telegramNotifications.telegramBotUsernameConfigured
			)
		: true

	useEffect(() => {
		if (hasTelegramNotifications) {
			setTelegramNotificationsUrl('')
			setTelegramNotificationsRequestId('')
			return
		}

		if (!pendingTelegramNotificationsRequest) return

		setTelegramNotificationsUrl(pendingTelegramNotificationsRequest.botUrl)
		setTelegramNotificationsRequestId(
			pendingTelegramNotificationsRequest.requestId
		)
	}, [hasTelegramNotifications, pendingTelegramNotificationsRequest])

	const handleDeleteAvatar = async () => {
		await userService.deleteProfileAvatar()
		await queryClient.invalidateQueries({ queryKey: ['get-profile'] })
	}

	const handleUploadAvatar = async (file: File) => {
		const avatarPath = await userService.uploadProfileAvatar(file)
		await queryClient.invalidateQueries({ queryKey: ['get-profile'] })
		return avatarPath
	}
	const {
		emailCodeRequested,
		requestedEmail,
		emailDeliveryUncertain,
		emailResendSeconds,
		phoneCodeRequested,
		isSendingEmailCode,
		isVerifyingEmailCode,
		isSendingPhoneCode,
		isVerifyingPhoneCode,
		telegramBindingRequested,
		telegramNotificationsBindingRequested,
		isStartingTelegramBinding,
		isUnlinkingTelegramBinding,
		isCancellingTelegramBinding,
		isStartingTelegramNotifications,
		isCancellingTelegramNotifications,
		isDisconnectingTelegramNotifications,
		requestEmailCode,
		confirmEmailCode,
		requestPhoneCode,
		confirmPhoneCode,
		requestTelegramBinding,
		requestTelegramNotificationsBinding,
		unlinkTelegramBinding,
		cancelTelegramBinding,
		cancelTelegramNotificationsBinding,
		disconnectTelegramNotifications,
		resetEmailBinding,
		resetPhoneBinding
	} = useProfileIdentityBinding()
	const isTelegramNotificationsWaiting = Boolean(
		!hasTelegramNotifications &&
		(telegramNotificationsBindingRequested ||
			pendingTelegramNotificationsRequest ||
			telegramNotificationsRequestId)
	)
	const telegramNotificationsCommand = telegramNotificationsRequestId
		? `/start ${telegramNotificationsRequestId}`
		: pendingTelegramNotificationsRequest?.requestId
			? `/start ${pendingTelegramNotificationsRequest.requestId}`
			: ''

	// ── Main profile form ──────────────────────────────────────────
	const {
		handleSubmit,
		register,
		reset,
		control,
		formState: { errors }
	} = useForm<ProfileEditForm>({ mode: 'onChange' })

	const handleProfileSubmit = handleSubmit(async data => {
		const ok = await onSubmit({ name: data.name, password: data.password })
		if (ok) {
			reset({ avatarPreview: '', name: data.name || '', password: '' })
			setIsProfilePasswordVisible(false)
		}
	})

	// ── Email binding form ─────────────────────────────────────────
	const {
		register: regEmail,
		handleSubmit: handleEmailSubmit,
		reset: resetEmailForm,
		trigger: triggerEmail,
		watch: watchEmail,
		formState: { errors: emailErrors }
	} = useForm<EmailBindingForm>({
		mode: 'onChange',
		defaultValues: { email: '', code: '' }
	})

	const emailValue = watchEmail('email')
	const emailRequestInFlightRef = useRef(false)
	const [isPreparingEmailCode, setIsPreparingEmailCode] = useState(false)
	const isRequestingEmailCode = isPreparingEmailCode || isSendingEmailCode

	const handleEmailCodeRequest = async () => {
		if (emailRequestInFlightRef.current || isVerifyingEmailCode) return
		emailRequestInFlightRef.current = true
		setIsPreparingEmailCode(true)
		const email = requestedEmail || emailValue.trim()
		try {
			const ok = await triggerEmail('email')
			if (!ok) return
			const sent = await requestEmailCode(email)
			if (sent) resetEmailForm({ email, code: '' })
		} finally {
			emailRequestInFlightRef.current = false
			setIsPreparingEmailCode(false)
		}
	}

	const handleEmailVerify = handleEmailSubmit(async data => {
		if (emailRequestInFlightRef.current || !requestedEmail) return
		const ok = await confirmEmailCode({
			email: requestedEmail,
			code: data.code.trim()
		})
		if (ok) {
			resetEmailForm({ email: '', code: '' })
			resetEmailBinding()
		}
	})

	const resetEmailFlow = () => {
		if (emailRequestInFlightRef.current || isVerifyingEmailCode) return
		resetEmailForm({ email: '', code: '' })
		resetEmailBinding()
	}

	// ── Phone binding form ─────────────────────────────────────────
	const {
		register: regPhone,
		handleSubmit: handlePhoneSubmit,
		reset: resetPhoneForm,
		trigger: triggerPhone,
		watch: watchPhone,
		setValue: setPhoneValue,
		formState: { errors: phoneErrors }
	} = useForm<PhoneBindingForm>({
		mode: 'onChange',
		defaultValues: { phone: '', code: '' }
	})

	const phoneInputRef = useRef<HTMLInputElement>(null)
	const phoneMask = usePhoneMask(setPhoneValue, phoneInputRef)
	const phoneValue = watchPhone('phone')

	const handlePhoneCodeRequest = async () => {
		const ok = await triggerPhone('phone')
		if (!ok) return
		const sent = await requestPhoneCode(phoneValue.trim())
		if (sent) resetPhoneForm({ phone: phoneValue.trim(), code: '' })
	}

	const handlePhoneVerify = handlePhoneSubmit(async data => {
		const ok = await confirmPhoneCode({
			phone: data.phone.trim(),
			code: data.code.trim()
		})
		if (ok) {
			resetPhoneForm({ phone: '', code: '' })
			phoneMask.reset()
			resetPhoneBinding()
		}
	})

	const resetPhoneFlow = () => {
		resetPhoneForm({ phone: '', code: '' })
		phoneMask.reset()
		resetPhoneBinding()
	}

	const clearTelegramBindingPolling = (dismissToast = false) => {
		if (telegramBindingPollRef.current) {
			clearInterval(telegramBindingPollRef.current)
			telegramBindingPollRef.current = null
		}

		if (dismissToast && telegramBindingToastRef.current) {
			toast.remove(telegramBindingToastRef.current)
			telegramBindingToastRef.current = null
		}
	}

	const clearTelegramNotificationsPolling = (dismissToast = false) => {
		if (telegramNotificationsPollRef.current) {
			clearInterval(telegramNotificationsPollRef.current)
			telegramNotificationsPollRef.current = null
		}

		if (dismissToast && telegramNotificationsToastRef.current) {
			toast.remove(telegramNotificationsToastRef.current)
			telegramNotificationsToastRef.current = null
		}
	}

	const startTelegramBindingPolling = () => {
		clearTelegramBindingPolling(true)

		const startedAt = Date.now()
		telegramBindingToastRef.current = toast.loading(
			'Ждём подтверждения в @auth_bot...'
		)

		telegramBindingPollRef.current = setInterval(async () => {
			try {
				const { data } = await userService.fetchProfile()
				const isConnected = Boolean(
					data.loginMethods?.includes('TELEGRAM')
				)

				if (isConnected) {
					clearTelegramBindingPolling()
					const toastId = telegramBindingToastRef.current || undefined
					telegramBindingToastRef.current = null
					setTelegramBindingUrl('')
					await queryClient.invalidateQueries({
						queryKey: ['get-profile']
					})
					toast.success('Telegram привязан как способ входа', {
						id: toastId
					})
					return
				}

				if (Date.now() - startedAt >= TELEGRAM_STATUS_POLL_TIMEOUT_MS) {
					clearTelegramBindingPolling()
					const toastId = telegramBindingToastRef.current || undefined
					telegramBindingToastRef.current = null
					toast.error(
						'Не удалось подтвердить Telegram. Откройте @auth_bot ещё раз.',
						{ id: toastId }
					)
				}
			} catch {
				if (Date.now() - startedAt >= TELEGRAM_STATUS_POLL_TIMEOUT_MS) {
					clearTelegramBindingPolling()
					const toastId = telegramBindingToastRef.current || undefined
					telegramBindingToastRef.current = null
					toast.error(
						'Не удалось проверить статус Telegram. Попробуйте позже.',
						{ id: toastId }
					)
				}
			}
		}, TELEGRAM_STATUS_POLL_INTERVAL_MS)
	}

	const startTelegramNotificationsPolling = () => {
		clearTelegramNotificationsPolling(true)

		const startedAt = Date.now()
		telegramNotificationsToastRef.current = toast.loading(
			'Ждём подтверждения в @winwidget_info_bot...'
		)

		telegramNotificationsPollRef.current = setInterval(async () => {
			try {
				const status =
					await userService.fetchProfileTelegramNotifications()

				if (status.connected) {
					clearTelegramNotificationsPolling()
					const toastId =
						telegramNotificationsToastRef.current || undefined
					telegramNotificationsToastRef.current = null
					setTelegramNotificationsUrl('')
					setTelegramNotificationsRequestId('')
					await queryClient.invalidateQueries({
						queryKey: ['profile-telegram-notifications']
					})
					toast.success('Telegram-уведомления подключены', {
						id: toastId
					})
					return
				}

				if (Date.now() - startedAt >= TELEGRAM_STATUS_POLL_TIMEOUT_MS) {
					clearTelegramNotificationsPolling()
					const toastId =
						telegramNotificationsToastRef.current || undefined
					telegramNotificationsToastRef.current = null
					toast.error(
						'Не удалось подтвердить уведомления. Откройте @winwidget_info_bot ещё раз.',
						{ id: toastId }
					)
				}
			} catch {
				if (Date.now() - startedAt >= TELEGRAM_STATUS_POLL_TIMEOUT_MS) {
					clearTelegramNotificationsPolling()
					const toastId =
						telegramNotificationsToastRef.current || undefined
					telegramNotificationsToastRef.current = null
					toast.error(
						'Не удалось проверить статус уведомлений. Попробуйте позже.',
						{ id: toastId }
					)
				}
			}
		}, TELEGRAM_STATUS_POLL_INTERVAL_MS)
	}

	useEffect(() => {
		return () => {
			if (telegramBindingPollRef.current) {
				clearInterval(telegramBindingPollRef.current)
			}

			if (telegramNotificationsPollRef.current) {
				clearInterval(telegramNotificationsPollRef.current)
			}

			if (telegramBindingToastRef.current) {
				toast.dismiss(telegramBindingToastRef.current)
			}

			if (telegramNotificationsToastRef.current) {
				toast.dismiss(telegramNotificationsToastRef.current)
			}
		}
	}, [])

	const handleTelegramBindingStart = async () => {
		let telegramWindow: Window | null = null

		if (typeof window !== 'undefined') {
			telegramWindow = window.open('about:blank', '_blank')
		}

		const data = await requestTelegramBinding()

		if (!data) {
			telegramWindow?.close()
			return
		}

		setTelegramBindingUrl(data.botUrl)
		startTelegramBindingPolling()

		if (telegramWindow) {
			telegramWindow.location.href = data.botUrl
		} else if (typeof window !== 'undefined') {
			window.open(data.botUrl, '_blank', 'noopener,noreferrer')
		}
	}

	const handleTelegramNotificationsStart = async () => {
		let telegramWindow: Window | null = null

		if (typeof window !== 'undefined') {
			telegramWindow = window.open('about:blank', '_blank')
		}

		const data = await requestTelegramNotificationsBinding()

		if (!data) {
			telegramWindow?.close()
			return
		}

		setTelegramNotificationsUrl(data.botUrl)
		setTelegramNotificationsRequestId(data.requestId)
		startTelegramNotificationsPolling()
		await queryClient.invalidateQueries({
			queryKey: ['profile-telegram-notifications']
		})

		if (telegramWindow) {
			telegramWindow.location.href = data.botUrl
		} else if (typeof window !== 'undefined') {
			window.open(data.botUrl, '_blank', 'noopener,noreferrer')
		}
	}

	const handleTelegramBindingCancel = async () => {
		clearTelegramBindingPolling(true)
		const cancelled = await cancelTelegramBinding()

		if (!cancelled) return

		setTelegramBindingUrl('')
		toast.success('Ожидание привязки Telegram отменено')
	}

	const handleTelegramNotificationsCancel = async () => {
		clearTelegramNotificationsPolling(true)
		const cancelled = await cancelTelegramNotificationsBinding()

		if (!cancelled) return

		setTelegramNotificationsUrl('')
		setTelegramNotificationsRequestId('')
		await queryClient.invalidateQueries({
			queryKey: ['profile-telegram-notifications']
		})
		toast.success('Ожидание подключения уведомлений отменено')
	}

	const handleTelegramNotificationsDisconnect = async () => {
		clearTelegramNotificationsPolling(true)
		const disconnected = await disconnectTelegramNotifications()

		if (!disconnected) return

		setTelegramNotificationsUrl('')
		setTelegramNotificationsRequestId('')
		await queryClient.invalidateQueries({
			queryKey: ['profile-telegram-notifications']
		})
	}

	const copyTelegramNotificationsCommand = async () => {
		if (!telegramNotificationsCommand) return

		try {
			await navigator.clipboard.writeText(telegramNotificationsCommand)
			toast.success('Команда для бота скопирована')
		} catch {
			toast.error('Не удалось скопировать команду')
		}
	}

	const phoneRegistration = regPhone('phone', {
		required: 'Введите номер телефона',
		pattern: { value: validPhone, message: 'Проверьте правильность ввода' }
	})

	return (
		<div>
			{/* ── Profile edit ──────────────────────────────────────── */}
			<div className={styles.section}>
				<p className={styles.sectionTitle}>Редактирование профиля</p>
				<form onSubmit={handleProfileSubmit}>
					<div className={styles.field}>
						<p className={styles.label}>Фото профиля</p>
						<Controller
							control={control}
							name="avatarPreview"
							render={({ field: { value, onChange } }) => (
								<FieldUploadFile
									onChange={onChange}
									onUpload={handleUploadAvatar}
									value={value}
									currentFile={user?.avatarPath || DEFAULT_AVATAR}
									placeholder="Фото профиля"
									canDelete
									uploadSuccessMessage="Фото профиля обновлено"
									onDelete={handleDeleteAvatar}
								/>
							)}
						/>
					</div>

					<div className={styles.field}>
						<label htmlFor="profile-name" className={styles.label}>
							Имя
						</label>
						<input
							id="profile-name"
							className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
							placeholder="Имя"
							defaultValue={user?.name || ''}
							{...register('name', {
								pattern: {
									value: validName,
									message: 'Мин. длина 2 символа'
								}
							})}
							aria-describedby={
								errors.name ? 'profile-name-error' : undefined
							}
						/>
						{errors.name && (
							<span id="profile-name-error" className={styles.errorMsg}>
								{errors.name.message}
							</span>
						)}
					</div>

					<div className={styles.field}>
						<label htmlFor="profile-password" className={styles.label}>
							Новый пароль
						</label>
						<div className={styles.passwordInputWrap}>
							<input
								id="profile-password"
								type={isProfilePasswordVisible ? 'text' : 'password'}
								className={`${styles.input} ${styles.passwordInput} ${errors.password ? styles.inputError : ''}`}
								placeholder="Введите новый пароль"
								autoComplete="new-password"
								{...register('password', {
									pattern: {
										value: validPassword,
										message:
											'Мин. 6 символов: цифра, строчная и заглавная буква'
									}
								})}
								aria-describedby={
									errors.password ? 'profile-password-error' : undefined
								}
							/>
							<button
								type="button"
								className={styles.passwordToggle}
								onClick={() =>
									setIsProfilePasswordVisible(value => !value)
								}
								aria-label={
									isProfilePasswordVisible
										? 'Скрыть пароль'
										: 'Показать пароль'
								}
								aria-pressed={isProfilePasswordVisible}
							>
								<AppIcon
									name={isProfilePasswordVisible ? 'eye-off' : 'eye'}
								/>
							</button>
						</div>
						{errors.password && (
							<span
								id="profile-password-error"
								className={styles.errorMsg}
							>
								{errors.password.message}
							</span>
						)}
					</div>

					<button type="submit" className={styles.btn} disabled={isSaving}>
						{isSaving ? 'Сохранение...' : 'Сохранить'}
					</button>
				</form>
			</div>

			{/* ── Identity binding ─────────────────────────────────── */}
			<div className={styles.section}>
				<p className={styles.sectionTitle}>Способы входа</p>
				{shouldShowPaymentContactNotice && (
					<div className={styles.paymentContactNotice}>
						<p className={styles.paymentContactNoticeTitle}>
							Для оплаты привяжите email или телефон
						</p>
						<p className={styles.paymentContactNoticeText}>
							Telegram подходит для входа, но для создания платежа нужен
							подтверждённый email или телефон в профиле.
						</p>
					</div>
				)}
				<div className={styles.identityGrid}>
					{/* Email */}
					<form
						onSubmit={handleEmailVerify}
						className={styles.identityCard}
					>
						<p className={styles.identityTitle}>Email</p>
						<p className={styles.identityDesc}>
							{user?.email
								? `Текущий: ${user.email}`
								: 'Добавьте email для входа.'}
						</p>
						<div className={styles.field}>
							<input
								className={`${styles.input} ${emailErrors.email ? styles.inputError : ''}`}
								placeholder={user?.email ? 'Новый email' : 'Email'}
								readOnly={emailCodeRequested || isRequestingEmailCode}
								{...regEmail('email', {
									required: 'Введите email',
									pattern: {
										value: validEmail,
										message: 'Проверьте правильность ввода'
									}
								})}
							/>
							{emailErrors.email && (
								<span className={styles.errorMsg}>
									{emailErrors.email.message}
								</span>
							)}
						</div>

						{emailCodeRequested && (
							<div className={styles.field}>
								<input
									className={`${styles.input} ${emailErrors.code ? styles.inputError : ''}`}
									placeholder="Код из email"
									{...regEmail('code', {
										required: 'Введите код',
										pattern: {
											value: validPhoneCode,
											message: 'Введите корректный код'
										}
									})}
								/>
								{emailErrors.code && (
									<span className={styles.errorMsg}>
										{emailErrors.code.message}
									</span>
								)}
								<span className={styles.hint}>
									{emailDeliveryUncertain
										? `Не удалось подтвердить отправку на ${requestedEmail}. Если письмо придёт, введите код.`
										: `Код отправлен на ${requestedEmail}`}
								</span>
							</div>
						)}

						<div className={styles.btnRow}>
							<button
								type="button"
								className={styles.btn}
								disabled={
									isRequestingEmailCode ||
									isVerifyingEmailCode ||
									emailResendSeconds > 0
								}
								onClick={handleEmailCodeRequest}
							>
								{isRequestingEmailCode
									? 'Отправка...'
									: emailResendSeconds > 0
										? `Повторить через ${emailResendSeconds} с`
										: emailCodeRequested
											? 'Отправить повторно'
											: user?.email
												? 'Сменить email'
												: 'Привязать email'}
							</button>
							{emailCodeRequested && (
								<button
									type="submit"
									className={styles.btnOutline}
									disabled={isRequestingEmailCode || isVerifyingEmailCode}
								>
									{isVerifyingEmailCode ? 'Проверка...' : 'Подтвердить'}
								</button>
							)}
						</div>
						{emailCodeRequested && (
							<button
								type="button"
								className={styles.resetLink}
								disabled={isRequestingEmailCode || isVerifyingEmailCode}
								onClick={resetEmailFlow}
							>
								Сбросить
							</button>
						)}
					</form>

					{/* Phone */}
					<form
						onSubmit={handlePhoneVerify}
						className={styles.identityCard}
					>
						<p className={styles.identityTitle}>Телефон</p>
						<p className={styles.identityDesc}>
							{user?.phone
								? `Текущий: ${user.phone}`
								: 'Добавьте телефон для входа.'}
						</p>
						<div className={styles.field}>
							<input
								className={`${styles.input} ${phoneErrors.phone ? styles.inputError : ''}`}
								placeholder={
									phoneMask.isMaskEmpty ? '+7 (9__)' : undefined
								}
								{...phoneRegistration}
								ref={el => {
									phoneRegistration.ref(el)
									phoneInputRef.current = el
								}}
								onFocus={phoneMask.onFocus}
								onClick={phoneMask.onClick}
								onKeyDown={phoneMask.onKeyDown}
								onBeforeInput={phoneMask.onBeforeInput}
								onInput={phoneMask.onInput}
								onPaste={phoneMask.onPaste}
								onBlur={e => {
									phoneMask.onBlur(e)
									phoneRegistration.onBlur(e)
								}}
							/>
							{phoneErrors.phone && (
								<span className={styles.errorMsg}>
									{phoneErrors.phone.message}
								</span>
							)}
						</div>

						{phoneCodeRequested && (
							<div className={styles.field}>
								<input
									className={`${styles.input} ${phoneErrors.code ? styles.inputError : ''}`}
									placeholder="Код из SMS"
									{...regPhone('code', {
										required: 'Введите код',
										pattern: {
											value: validPhoneCode,
											message: 'Введите корректный код'
										}
									})}
								/>
								{phoneErrors.code && (
									<span className={styles.errorMsg}>
										{phoneErrors.code.message}
									</span>
								)}
								<span className={styles.hint}>
									Код отправлен на {phoneValue}
								</span>
							</div>
						)}

						<div className={styles.btnRow}>
							<button
								type="button"
								className={styles.btn}
								disabled={isSendingPhoneCode || isVerifyingPhoneCode}
								onClick={handlePhoneCodeRequest}
							>
								{isSendingPhoneCode
									? 'Отправка...'
									: phoneCodeRequested
										? 'Отправить повторно'
										: user?.phone
											? 'Сменить телефон'
											: 'Привязать телефон'}
							</button>
							{phoneCodeRequested && (
								<button
									type="submit"
									className={styles.btnOutline}
									disabled={isSendingPhoneCode || isVerifyingPhoneCode}
								>
									{isVerifyingPhoneCode ? 'Проверка...' : 'Подтвердить'}
								</button>
							)}
						</div>
						{phoneCodeRequested && (
							<button
								type="button"
								className={styles.resetLink}
								onClick={resetPhoneFlow}
							>
								Сбросить
							</button>
						)}
					</form>

					<div className={styles.identityCard}>
						<p className={styles.identityTitle}>Telegram</p>
						<p className={styles.identityDesc}>
							{hasTelegram
								? 'Telegram-аккаунт привязан.'
								: 'Привяжите Telegram-аккаунт для быстрого входа'}
						</p>

						{telegramBindingRequested && !hasTelegram && (
							<p className={styles.hint}>
								Откройте @auth_bot, нажмите Start и кнопку привязки. После
								этого статус обновится автоматически.
							</p>
						)}

						{hasTelegram && !hasOtherLoginMethod && (
							<p className={styles.hint}>
								Чтобы отключить Telegram, сначала привяжите другой способ
								входа.
							</p>
						)}

						<div className={styles.btnRow}>
							{hasTelegram ? (
								<>
									<button
										type="button"
										className={styles.btnOutline}
										disabled
									>
										Привязан
									</button>
									<button
										type="button"
										className={styles.btnOutline}
										disabled={
											isUnlinkingTelegramBinding || !hasOtherLoginMethod
										}
										onClick={unlinkTelegramBinding}
									>
										{isUnlinkingTelegramBinding
											? 'Отвязываем...'
											: 'Отвязать'}
									</button>
								</>
							) : (
								<button
									type="button"
									className={styles.btn}
									disabled={
										isStartingTelegramBinding ||
										isCancellingTelegramBinding
									}
									onClick={handleTelegramBindingStart}
								>
									{isStartingTelegramBinding
										? 'Открываем...'
										: telegramBindingRequested
											? 'Открыть @auth_bot ещё раз'
											: 'Привязать Telegram'}
								</button>
							)}
						</div>

						{telegramBindingUrl && !hasTelegram && (
							<div className={styles.inlineActions}>
								<button
									type="button"
									className={styles.resetLink}
									onClick={() => {
										if (typeof window !== 'undefined') {
											window.open(
												telegramBindingUrl,
												'_blank',
												'noopener,noreferrer'
											)
										}
									}}
								>
									Открыть ссылку вручную
								</button>
								<button
									type="button"
									className={styles.resetLink}
									disabled={isCancellingTelegramBinding}
									onClick={handleTelegramBindingCancel}
								>
									{isCancellingTelegramBinding
										? 'Отменяем...'
										: 'Отменить ожидание'}
								</button>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* ── Notifications ─────────────────────────────────── */}
			<div className={styles.section}>
				<p className={styles.sectionTitle}>Настройка уведомлений</p>
				<div className={styles.identityCard}>
					<p className={styles.identityTitle}>Telegram-уведомления</p>
					<p className={styles.identityDesc}>
						{hasTelegramNotifications
							? telegramNotifications?.username
								? `Подключены: @${telegramNotifications.username}`
								: 'Подключены через инфо-бота.'
							: 'Разрешите инфо-боту писать вам сообщения, чтобы получать заявки с виджетов и другие сервисные уведомления.'}
					</p>

					{!isTelegramNotificationsConfigured && (
						<p className={styles.hint}>
							@winwidget_info_bot пока не настроен. Подключение временно
							недоступно.
						</p>
					)}

					{isTelegramNotificationsWaiting && !hasTelegramNotifications && (
						<p className={styles.hint}>
							Откройте @winwidget_info_bot и нажмите Start. Если Telegram
							не подставил команду автоматически, отправьте боту:{' '}
							{telegramNotificationsCommand}
						</p>
					)}

					<div className={styles.btnRow}>
						{hasTelegramNotifications ? (
							<>
								<button
									type="button"
									className={styles.btnOutline}
									disabled
								>
									Подключены
								</button>
								<button
									type="button"
									className={styles.btnOutline}
									disabled={isDisconnectingTelegramNotifications}
									onClick={handleTelegramNotificationsDisconnect}
								>
									{isDisconnectingTelegramNotifications
										? 'Отвязываем...'
										: 'Отвязать'}
								</button>
							</>
						) : (
							<button
								type="button"
								className={styles.btn}
								disabled={
									isStartingTelegramNotifications ||
									isCancellingTelegramNotifications ||
									!isTelegramNotificationsConfigured
								}
								onClick={handleTelegramNotificationsStart}
							>
								{isStartingTelegramNotifications
									? 'Открываем...'
									: isTelegramNotificationsWaiting
										? 'Открыть @winwidget_info_bot ещё раз'
										: 'Подключить уведомления'}
							</button>
						)}
					</div>

					{telegramNotificationsUrl && !hasTelegramNotifications && (
						<div className={styles.inlineActions}>
							<button
								type="button"
								className={styles.resetLink}
								onClick={() => {
									if (typeof window !== 'undefined') {
										window.open(
											telegramNotificationsUrl,
											'_blank',
											'noopener,noreferrer'
										)
									}
								}}
							>
								Открыть ссылку вручную
							</button>
							{telegramNotificationsCommand && (
								<button
									type="button"
									className={styles.resetLink}
									onClick={copyTelegramNotificationsCommand}
								>
									Скопировать команду
								</button>
							)}
							<button
								type="button"
								className={styles.resetLink}
								disabled={isCancellingTelegramNotifications}
								onClick={handleTelegramNotificationsCancel}
							>
								{isCancellingTelegramNotifications
									? 'Отменяем...'
									: 'Отменить ожидание'}
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export default CabinetProfile
