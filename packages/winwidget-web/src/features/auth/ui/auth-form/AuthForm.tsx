'use client'
import styles from '@/features/auth/ui/AuthForm.module.scss'
import { IAuthFormProps } from '@/features/auth/ui/auth-form/auth-form.interface'
import AuthToggle from '@/features/auth/ui/auth-form/auth-toggle/AuthToggle'
import SocialMediaButtons from '@/features/auth/ui/auth-form/social-media-buttons/SocialMediaButtons'
import LoginCodeFallback from './LoginCodeFallback'
import useAuthForm from '@/features/auth/model/useAuthForm'
import useAuthReturnUrl from '@/features/auth/model/useAuthReturnUrl'
import FieldEmail from '@/shared/ui/form-elements/auth-page/field-email/FieldEmail'
import FieldPassword from '@/shared/ui/form-elements/auth-page/field-password/FieldPassword'
import FieldPhone from '@/shared/ui/form-elements/auth-page/field-phone/FieldPhone'
import FieldSmsCode from '@/shared/ui/form-elements/auth-page/field-sms-code/FieldSmsCode'
import {
	PHONE_INPUT_MAX_LENGTH,
	PHONE_INPUT_PLACEHOLDER,
	formatPhoneInput,
	isPhoneInputValid
} from '@/shared/lib/phone'
import { validEmail, validPassword, validPhoneCode } from '@/shared/regex'
import clsx from 'clsx'
import { NextPage } from 'next'
import { Controller } from 'react-hook-form'

const AuthForm: NextPage<IAuthFormProps> = ({
	isLogin,
	authMessage,
	authReturnUrl: initialAuthReturnUrl
}) => {
	const authReturnUrl = useAuthReturnUrl(initialAuthReturnUrl)
	const {
		isRecaptchaUnavailable,
		retryRecaptcha,
		completeCodeLogin,
		handleSubmit,
		isLoading,
		onSubmit,
		register,
		control,
		formState: { errors, touchedFields, isSubmitted },
		authMethod,
		setAuthMethod,
		isPhoneCodeRequested,
		isEmailCodeRequested,
		emailValue,
		phoneValue,
		resendEmailCode,
		startTelegramAuth,
		isTelegramAuthLoading,
		isTelegramAuthRequested,
		telegramAuthUrl,
		authMessage: currentAuthMessage,
		resetEmailCodeStep,
		resetPhoneCodeStep,
		resetTelegramAuthStep
	} = useAuthForm(isLogin, authMessage, authReturnUrl)

	if (isLogin && isRecaptchaUnavailable) {
		return (
			<LoginCodeFallback
				authReturnUrl={authReturnUrl}
				onAuthenticated={completeCodeLogin}
				onRetryCaptcha={retryRecaptcha}
			/>
		)
	}

	return (
		<form onSubmit={handleSubmit(onSubmit)} className={styles.form}>
			<div className={styles['auth-method-toggle']}>
				<button
					type="button"
					className={clsx(
						styles['method-button'],
						authMethod === 'email' && styles['method-button-active']
					)}
					onClick={() => setAuthMethod('email')}
				>
					Email
				</button>
				<button
					type="button"
					className={clsx(
						styles['method-button'],
						authMethod === 'phone' && styles['method-button-active']
					)}
					onClick={() => setAuthMethod('phone')}
				>
					Телефон
				</button>
			</div>

			{currentAuthMessage && (
				<div className={styles['auth-alert']} role="alert">
					{currentAuthMessage}
				</div>
			)}

			{authMethod === 'email' ? (
				<>
					<FieldEmail
						{...register('email', {
							required: 'Введите email',
							pattern: {
								value: validEmail,
								message: 'Проверьте правильность ввода email'
							}
						})}
						placeholder="Email:"
						type="email"
						error={errors.email}
						data-validated={
							touchedFields.email || isSubmitted ? 'true' : undefined
						}
						disabled={!isLogin && isEmailCodeRequested}
					/>
					{!isLogin && isEmailCodeRequested && (
						<>
							<FieldSmsCode
								{...register('code', {
									required: 'Введите код из email',
									pattern: {
										value: validPhoneCode,
										message: 'Код должен содержать 4-6 цифр'
									}
								})}
								placeholder="Код из email:"
								type="text"
								error={errors.code}
								data-validated={
									touchedFields.code || isSubmitted ? 'true' : undefined
								}
							/>
							<div className={styles['verification-hint']}>
								Код отправлен на email {emailValue}. Срок действия 10
								минут.
							</div>
							<div className={styles['link-actions']}>
								<button
									type="button"
									className={styles['link-button']}
									onClick={resendEmailCode}
									disabled={isLoading}
								>
									Отправить код повторно
								</button>
								<button
									type="button"
									className={styles['link-button']}
									onClick={resetEmailCodeStep}
									disabled={isLoading}
								>
									Изменить email
								</button>
							</div>
						</>
					)}
				</>
			) : (
				<>
					<Controller
						name="phone"
						control={control}
						rules={{
							required: 'Введите номер телефона',
							validate: value =>
								isPhoneInputValid(value || '') ||
								'Проверьте правильность ввода номера телефона'
						}}
						render={({ field }) => (
							<FieldPhone
								{...field}
								value={field.value || ''}
								placeholder={PHONE_INPUT_PLACEHOLDER}
								type="tel"
								maxLength={PHONE_INPUT_MAX_LENGTH}
								error={errors.phone}
								data-validated={
									touchedFields.phone || isSubmitted ? 'true' : undefined
								}
								disabled={!isLogin && isPhoneCodeRequested}
								onChange={event =>
									field.onChange(
										formatPhoneInput(event.currentTarget.value)
									)
								}
							/>
						)}
					/>
					{!isLogin && isPhoneCodeRequested && (
						<>
							<FieldSmsCode
								{...register('code', {
									required: 'Введите код из SMS',
									pattern: {
										value: validPhoneCode,
										message: 'Код должен содержать 4-6 цифр'
									}
								})}
								placeholder="Код из SMS:"
								type="text"
								error={errors.code}
								data-validated={
									touchedFields.code || isSubmitted ? 'true' : undefined
								}
							/>
							<div className={styles['verification-hint']}>
								Код отправлен на номер {phoneValue}
							</div>
							<div className={styles['link-actions']}>
								<button
									type="button"
									className={styles['link-button']}
									onClick={resetPhoneCodeStep}
									disabled={isLoading}
								>
									Изменить номер
								</button>
							</div>
						</>
					)}
				</>
			)}

			<FieldPassword
				{...register('password', {
					required:
						!isLogin && authMethod === 'email' && isEmailCodeRequested
							? false
							: 'Введите пароль',
					pattern:
						!isLogin && authMethod === 'email' && isEmailCodeRequested
							? undefined
							: {
									value: validPassword,
									message:
										'Мин. длина 6 символов. Должен содержать 1 цифру 0-9, 1 строчную букву a-z и 1 заглавную букву A-Z.'
								}
				})}
				placeholder="Пароль:"
				type="password"
				error={errors.password}
				data-validated={
					touchedFields.password || isSubmitted ? 'true' : undefined
				}
				disabled={
					!isLogin && authMethod === 'email' && isEmailCodeRequested
				}
			/>

			<div className={clsx(styles['wrapper-button'])}>
				<button
					type="submit"
					className={clsx(styles['button-primary'])}
					disabled={isLoading}
				>
					{isLoading
						? 'Загрузка...'
						: isLogin
							? 'Войти'
							: authMethod === 'phone'
								? !isPhoneCodeRequested
									? 'Получить код'
									: 'Зарегистрироваться'
								: !isEmailCodeRequested
									? 'Получить код'
									: 'Подтвердить email'}
				</button>
			</div>

			<div className={styles['social-section']}>
				<SocialMediaButtons
					onTelegramAuthStart={startTelegramAuth}
					isTelegramAuthLoading={isTelegramAuthLoading}
					authReturnUrl={authReturnUrl}
				/>
				{isTelegramAuthRequested && (
					<div className={styles['telegram-auth-box']}>
						<div className={styles['verification-hint']}>
							В Auth_bot нажмите Start, затем кнопку подтверждения входа.
							Статус на сайте обновится автоматически.
						</div>
						<div className={styles['link-actions']}>
							{telegramAuthUrl && (
								<button
									type="button"
									className={styles['link-button']}
									onClick={() => {
										window.open(
											telegramAuthUrl,
											'_blank',
											'noopener,noreferrer'
										)
									}}
								>
									Открыть Auth_bot ещё раз
								</button>
							)}
							<button
								type="button"
								className={styles['link-button']}
								onClick={resetTelegramAuthStep}
							>
								Отменить ожидание
							</button>
						</div>
					</div>
				)}
			</div>

			<AuthToggle isLogin={isLogin} authReturnUrl={authReturnUrl} />
		</form>
	)
}

export default AuthForm
