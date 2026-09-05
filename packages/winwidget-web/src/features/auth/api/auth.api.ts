import {
	axiosClassicRequest,
	axiosInterceptorsRequest,
	refreshAccessToken,
	saveTokenStorage
} from '@/shared/api'
import { IFormData } from '@/features/auth/model/form.types'
import type { IUser } from '@/entities/user'
import {
	LoginOtpChannel,
	LoginOtpChallenge,
	parseLoginOtpCapabilities,
	parseLoginOtpChallenge
} from '../model/login-otp.contract'

interface IAuthResponse {
	accessToken: string
	user: IUser
}

interface IEmail {
	email?: string
	phone?: string
}

interface IPhonePayload {
	phone: string
	password?: string
	code?: string
	referrerId?: string
}

interface IEmailCodePayload {
	email: string
	password?: string
	code?: string
	referrerId?: string
}

interface ITelegramAuthVerifyPayload {
	requestId: string
	code: string
	referrerId?: string
}

interface ITelegramAuthCompletePayload {
	requestId: string
	referrerId?: string
}

interface ITelegramAuthCancelPayload {
	requestId: string
}

export interface IEmailRegistrationResponse {
	email: string
	expiresAt: string
	resendAvailableAt: string
}

export interface ITelegramAuthStartResponse {
	requestId: string
	botUrl: string
	expiresAt: string
}

export type ITelegramAuthCompleteResponse =
	| {
			confirmed: false
	  }
	| {
			confirmed: true
			accessToken: string
			user: IUser
	  }

export interface IUserSession {
	id: string
	userAgent: string | null
	ipAddress: string | null
	createdAt: string
	lastUsedAt: string
	expiresAt: string
	isCurrent: boolean
}

export interface IRevokeSessionResponse {
	currentSessionRevoked: boolean
}

export interface IAuthSettings {
	recaptchaEnabled: boolean
	googleAuthEnabled: boolean
	yandexAuthEnabled: boolean
	githubAuthEnabled: boolean
	vkAuthEnabled: boolean
	telegramAuthEnabled: boolean
}

export const authSettingsService = {
	async get(): Promise<IAuthSettings> {
		const { data } =
			await axiosClassicRequest.get<IAuthSettings>('/auth/settings')

		return data
	},

	async update(payload: Partial<IAuthSettings>): Promise<IAuthSettings> {
		const { data } = await axiosInterceptorsRequest.patch<IAuthSettings>(
			'/auth/admin/settings',
			payload
		)

		return data
	}
}

class AuthService {
	async loginOtpCapabilities() {
		const { data } = await axiosClassicRequest.get<unknown>(
			'/auth/login-otp/capabilities',
			{ timeout: 10000 }
		)
		return parseLoginOtpCapabilities(data)
	}

	async requestLoginOtp(channel: LoginOtpChannel, destination: string) {
		const { data } = await axiosClassicRequest.post<unknown>(
			'/auth/login-otp/request',
			{ channel, destination },
			{ timeout: 20000 }
		)
		return parseLoginOtpChallenge(data)
	}

	async verifyLoginOtp(challenge: LoginOtpChallenge, code: string) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			'/auth/login-otp/verify',
			{
				challengeId: challenge.challengeId,
				browserToken: challenge.browserToken,
				code
			},
			{ timeout: 20000 }
		)
		if (!response.data.accessToken)
			throw new Error('Не удалось завершить вход')
		saveTokenStorage(response.data.accessToken)
		return response
	}

	async main(type: 'login', data: IFormData, token?: string | null) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			`/auth/${type}`,
			data,
			{
				headers: {
					recaptcha: token
				}
			}
		)

		if (response.data.accessToken) {
			saveTokenStorage(response.data.accessToken)
		}

		return response
	}

	async getNewTokens() {
		return refreshAccessToken()
	}

	async getRestorePassword(data: IEmail, token?: string | null) {
		const response = await axiosClassicRequest.patch<IEmail>(
			'/auth/restore-password',
			{ email: data.email, phone: data.phone },
			{
				headers: {
					recaptcha: token
				}
			}
		)

		return response
	}

	async logout() {
		return axiosClassicRequest.post<boolean>('/auth/logout')
	}

	async getSessions() {
		const { data } =
			await axiosInterceptorsRequest.get<IUserSession[]>('/auth/sessions')

		return data
	}

	async revokeSession(sessionId: string) {
		const { data } =
			await axiosInterceptorsRequest.delete<IRevokeSessionResponse>(
				`/auth/sessions/${sessionId}`
			)

		return data
	}

	async revokeAllSessions() {
		const { data } =
			await axiosInterceptorsRequest.delete<boolean>('/auth/sessions')

		return data
	}

	async sendEmailCode(data: IEmailCodePayload, token?: string | null) {
		return axiosClassicRequest.post<IEmailRegistrationResponse>(
			'/auth/register',
			{
				email: data.email,
				password: data.password
			},
			{
				headers: {
					recaptcha: token
				}
			}
		)
	}

	async registerByEmail(data: IEmailCodePayload, token?: string | null) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			'/auth/email/register',
			{
				email: data.email,
				code: data.code,
				referrerId: data.referrerId
			},
			{
				headers: {
					recaptcha: token
				}
			}
		)

		if (response.data.accessToken) {
			saveTokenStorage(response.data.accessToken)
		}

		return response
	}

	async resendEmailCode(data: IEmailCodePayload, token?: string | null) {
		return axiosClassicRequest.post<IEmailRegistrationResponse>(
			'/auth/email/resend-code',
			{
				email: data.email
			},
			{
				headers: {
					recaptcha: token
				}
			}
		)
	}

	async sendPhoneCode(data: IPhonePayload, token?: string | null) {
		return axiosClassicRequest.post<boolean>(
			'/auth/phone/send-code',
			{ phone: data.phone },
			{
				headers: {
					recaptcha: token
				}
			}
		)
	}

	async registerByPhone(data: IPhonePayload, token?: string | null) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			'/auth/phone/register',
			{
				phone: data.phone,
				password: data.password,
				code: data.code,
				referrerId: data.referrerId
			},
			{
				headers: {
					recaptcha: token
				}
			}
		)

		if (response.data.accessToken) {
			saveTokenStorage(response.data.accessToken)
		}

		return response
	}

	async loginByPhone(data: IPhonePayload, token?: string | null) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			'/auth/phone/login',
			{
				phone: data.phone,
				password: data.password
			},
			{
				headers: {
					recaptcha: token
				}
			}
		)

		if (response.data.accessToken) {
			saveTokenStorage(response.data.accessToken)
		}

		return response
	}

	async startTelegramAuth(token?: string | null) {
		return axiosClassicRequest.post<ITelegramAuthStartResponse>(
			'/auth/telegram/start',
			{},
			{
				headers: {
					recaptcha: token
				}
			}
		)
	}

	async verifyTelegramAuth(
		data: ITelegramAuthVerifyPayload,
		token?: string | null
	) {
		const response = await axiosClassicRequest.post<IAuthResponse>(
			'/auth/telegram/verify',
			{
				requestId: data.requestId,
				code: data.code,
				referrerId: data.referrerId
			},
			{
				headers: {
					recaptcha: token
				}
			}
		)

		if (response.data.accessToken) {
			saveTokenStorage(response.data.accessToken)
		}

		return response
	}

	async completeTelegramAuth(data: ITelegramAuthCompletePayload) {
		const response =
			await axiosClassicRequest.post<ITelegramAuthCompleteResponse>(
				'/auth/telegram/complete',
				{
					requestId: data.requestId,
					referrerId: data.referrerId
				}
			)

		if (response.data.confirmed && response.data.accessToken) {
			saveTokenStorage(response.data.accessToken)
		}

		return response
	}

	async cancelTelegramAuth(data: ITelegramAuthCancelPayload) {
		return axiosClassicRequest.post('/auth/telegram/cancel', {
			requestId: data.requestId
		})
	}
}

const authService = new AuthService()

export default authService
