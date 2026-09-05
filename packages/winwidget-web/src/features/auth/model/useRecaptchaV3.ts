'use client'
import { authSettingsService } from '@/features/auth/api/auth.api'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
	executeRecaptchaToken,
	loadRecaptchaScript,
	RecaptchaUnavailableError,
	waitForRecaptchaReady
} from './recaptcha-client'

export const useRecaptchaV3 = () => {
	const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
	const isProductionMode = process.env.NEXT_PUBLIC_MODE === 'production'
	const [isReady, setIsReady] = useState(false)
	const [isUnavailable, setIsUnavailable] = useState(false)
	const [retry, setRetry] = useState(0)
	const { data: authSettings } = useQuery({
		queryKey: ['auth-settings'],
		queryFn: authSettingsService.get,
		enabled: isProductionMode
	})
	const isRecaptchaEnabled =
		isProductionMode && (authSettings?.recaptchaEnabled ?? true)

	useEffect(() => {
		if (!isRecaptchaEnabled) return
		let ignore = false
		setIsReady(false)
		setIsUnavailable(false)
		const initialize = async () => {
			if (!siteKey) throw new RecaptchaUnavailableError()
			await loadRecaptchaScript(siteKey)
			await waitForRecaptchaReady()
		}
		void initialize()
			.then(() => {
				if (!ignore) setIsReady(true)
			})
			.catch(() => {
				if (!ignore) setIsUnavailable(true)
			})
		return () => {
			ignore = true
		}
	}, [siteKey, isRecaptchaEnabled, retry])

	const executeRecaptcha = async (action: string) => {
		if (!isRecaptchaEnabled) return null
		try {
			if (!siteKey) throw new RecaptchaUnavailableError()
			await loadRecaptchaScript(siteKey)
			await waitForRecaptchaReady()
			const token = await executeRecaptchaToken(siteKey, action)
			setIsUnavailable(false)
			setIsReady(true)
			return token
		} catch (error) {
			setIsUnavailable(true)
			setIsReady(false)
			throw error
		}
	}

	return {
		executeRecaptcha,
		isRecaptchaEnabled,
		isRecaptchaReady: !isRecaptchaEnabled || isReady,
		isRecaptchaUnavailable: isRecaptchaEnabled && isUnavailable,
		markRecaptchaUnavailable: () => setIsUnavailable(true),
		retryRecaptcha: () => {
			setIsUnavailable(false)
			setRetry(value => value + 1)
		}
	}
}
