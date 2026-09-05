export class RecaptchaUnavailableError extends Error {
	constructor() {
		super('Сервис проверки CAPTCHA временно недоступен')
		this.name = 'RecaptchaUnavailableError'
	}
}

declare global {
	interface Window {
		grecaptcha?: {
			ready: (callback: () => void) => void
			execute: (
				siteKey: string,
				options: { action: string }
			) => Promise<string>
		}
	}
}

let scriptPromise: Promise<void> | null = null

export const loadRecaptchaScript = (siteKey: string) => {
	if (typeof window === 'undefined' || window.grecaptcha)
		return Promise.resolve()
	if (scriptPromise) return scriptPromise

	const pending = new Promise<void>((resolve, reject) => {
		const host =
			process.env.NEXT_PUBLIC_RECAPTCHA_HOST || 'https://www.recaptcha.net'
		const existing = document.querySelector<HTMLScriptElement>(
			`script[src^="${host}/recaptcha/api.js?render="], script[src^="https://www.google.com/recaptcha/api.js?render="], script[src^="https://www.recaptcha.net/recaptcha/api.js?render="]`
		)
		const script = existing || document.createElement('script')
		let settled = false
		const finish = (failed: boolean) => {
			if (settled) return
			settled = true
			window.clearTimeout(timeout)
			script.removeEventListener('load', onLoad)
			script.removeEventListener('error', onError)
			if (failed) {
				// Never remove a script created by a different integration.
				if (!existing) script.remove()
				reject(new RecaptchaUnavailableError())
			} else resolve()
		}
		const onLoad = () => finish(!window.grecaptcha)
		const onError = () => finish(true)
		const timeout = window.setTimeout(onError, 8000)
		script.addEventListener('load', onLoad)
		script.addEventListener('error', onError)
		if (!existing) {
			script.src = `${host}/recaptcha/api.js?${new URLSearchParams({ render: siteKey, hl: 'ru' })}`
			script.async = true
			script.defer = true
			document.head.appendChild(script)
		}
	})
	scriptPromise = pending
	void pending.catch(() => {
		if (scriptPromise === pending) scriptPromise = null
	})
	return pending
}

const bounded = <T>(
	work: () => Promise<T>,
	milliseconds: number
): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timeout = window.setTimeout(
			() => reject(new RecaptchaUnavailableError()),
			milliseconds
		)
		Promise.resolve()
			.then(work)
			.then(resolve, () => reject(new RecaptchaUnavailableError()))
			.finally(() => window.clearTimeout(timeout))
	})

export const waitForRecaptchaReady = () =>
	bounded(
		() =>
			new Promise<void>((resolve, reject) => {
				if (!window.grecaptcha)
					return reject(new RecaptchaUnavailableError())
				window.grecaptcha.ready(resolve)
			}),
		5000
	)

export const executeRecaptchaToken = (siteKey: string, action: string) =>
	bounded(async () => {
		if (!window.grecaptcha) throw new RecaptchaUnavailableError()
		const token = await window.grecaptcha.execute(siteKey, { action })
		if (typeof token !== 'string' || !token)
			throw new RecaptchaUnavailableError()
		return token
	}, 8000)
