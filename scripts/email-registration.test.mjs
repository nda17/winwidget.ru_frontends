import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(
	new URL('../apps/crm/package.json', import.meta.url)
)('jsdom')
const base = new URL(
	'../packages/winwidget-web/src/features/auth/',
	import.meta.url
)
const compile = async path =>
	ts.transpileModule(await readFile(new URL(path, base), 'utf8'), {
		fileName: path,
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			jsx: ts.JsxEmit.ReactJSX
		}
	}).outputText
const [hookSource, formSource, restoreSource, apiSource] =
	await Promise.all([
		compile('model/useAuthForm.ts'),
		compile('ui/auth-form/AuthForm.tsx'),
		compile('model/useRestorePasswordForm.ts'),
		compile('api/auth.api.ts')
	])
const load = (source, imports) => {
	const loadedModule = { exports: {} }
	new Function('exports', 'module', 'require', source)(
		loadedModule.exports,
		loadedModule,
		name => {
			if (Object.hasOwn(imports, name)) return imports[name]
			if (name.startsWith('@/') || name.startsWith('.'))
				throw new Error(`Unexpected import: ${name}`)
			return require(name)
		}
	)
	return loadedModule.exports.default
}
const deferred = () => {
	let resolve, reject
	const promise = new Promise((ok, fail) => {
		resolve = ok
		reject = fail
	})
	return { promise, resolve, reject }
}
const networkError = () => ({ isAxiosError: true, code: 'ECONNABORTED' })

async function mount(t, options = {}) {
	const dom = new JSDOM('<div id="root"></div>', {
		url: 'https://winwidget.test/register'
	})
	const previous = new Map()
	for (const [key, value] of Object.entries({
		window: dom.window,
		document: dom.window.document,
		navigator: dom.window.navigator,
		HTMLElement: dom.window.HTMLElement,
		Node: dom.window.Node,
		IS_REACT_ACT_ENVIRONMENT: true
	})) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, {
			value,
			configurable: true,
			writable: true
		})
	}
	const React = require('react')
	assert.match(React.version, /^18\./)
	const { act } = React
	const { createRoot } = require('react-dom/client')
	const {
		QueryClient,
		QueryClientProvider
	} = require('@tanstack/react-query')
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { gcTime: Infinity, retry: false },
			mutations: { gcTime: Infinity, retry: false }
		}
	})
	let clock = Date.now()
	const originalNow = Date.now
	Date.now = () => clock
	const intervals = new Map()
	let intervalId = 0
	dom.window.setInterval = callback => {
		intervals.set(++intervalId, callback)
		return intervalId
	}
	dom.window.clearInterval = id => intervals.delete(id)
	if (options.saved)
		dom.window.localStorage.setItem(
			'pendingEmailRegistration',
			options.saved
		)
	if (options.blockStorage)
		Object.defineProperty(dom.window, 'localStorage', {
			get() {
				throw new Error('Storage unavailable')
			}
		})
	const noop = () => {}
	const calls = {
		send: [],
		resend: [],
		verify: [],
		restore: [],
		captcha: [],
		toast: [],
		auth: [],
		navigation: []
	}
	const response = () => ({
		data: {
			email: 'user@example.test',
			expiresAt: new Date(clock + 600000).toISOString(),
			resendAvailableAt: new Date(clock + 60000).toISOString()
		}
	})
	const service = {
		sendEmailCode: async (...args) => {
			calls.send.push(args)
			return options.send ? options.send(...args) : response()
		},
		resendEmailCode: async (...args) => {
			calls.resend.push(args)
			return options.resend ? options.resend(...args) : response()
		},
		registerByEmail: async (...args) => {
			calls.verify.push(args)
			return options.verify
				? options.verify(...args)
				: { data: { accessToken: 'test' } }
		},
		getRestorePassword: async (...args) => {
			calls.restore.push(args)
			return options.restore?.(...args)
		}
	}
	const toast = message => calls.toast.push(message)
	toast.error = toast
	toast.success = toast
	toast.dismiss = noop
	const recaptcha = {
		executeRecaptcha: async action => {
			calls.captcha.push(action)
			return options.captcha ? options.captcha(action) : 'test-captcha'
		},
		isRecaptchaEnabled: true,
		isRecaptchaReady: true,
		isRecaptchaUnavailable: false,
		markRecaptchaUnavailable: noop,
		retryRecaptcha: noop
	}
	const imports = {
		clsx: { default: require('clsx') },
		'@/shared/config/pages/public.config': {
			PUBLIC_PAGES: { HOME: '/', CABINET: '/cabinet' }
		},
		'@/features/auth/model/useRecaptchaV3': {
			useRecaptchaV3: () => recaptcha
		},
		'@/shared/lib/navigation/NavigationProvider': {
			useNavigationContext: () => ({})
		},
		'@/features/auth/api/auth.api': { default: service },
		'@/shared/regex': {
			validEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
			validPhoneCode: /^\d{4,6}$/,
			validPassword: /(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])\S{6,}/,
			validPhone: /^[0-9+()\-\s]{10,20}$/
		},
		'@/shared/lib/phone': { parsePhoneInput: value => value },
		'@/entities/user': {
			useAuthStore: selector =>
				selector({
					setAuth: value => calls.auth.push(value),
					setAuthResolved: noop
				})
		},
		'@/shared/lib/navigation/useZoneRouter': {
			useZoneRouter: () => ({
				replace: value => calls.navigation.push(value)
			})
		},
		'react-hot-toast': { default: toast },
		'@/shared/lib/auth-return-url': {
			clearAuthReturnIntent: noop,
			getSafeAuthReturnUrl: () => null,
			withAuthReturnUrl: value => value
		},
		'@/shared/lib/hooks/usePhoneMask': {
			usePhoneMask: () => ({ reset: noop })
		}
	}
	const hook = load(
		options.restoreMode ? restoreSource : hookSource,
		imports
	)
	let latest
	const useHook = (...args) => {
		latest = hook(...args)
		return latest
	}
	const Field = React.forwardRef(({ error, ...props }, ref) =>
		React.createElement('input', { ...props, ref })
	)
	Field.displayName = 'EmailRegistrationTestField'
	const fields = Object.fromEntries(
		[
			'email/FieldEmail',
			'password/FieldPassword',
			'phone/FieldPhone',
			'sms-code/FieldSmsCode'
		].map(name => [
			`@/shared/ui/form-elements/auth-page/field-${name}`,
			{ default: Field }
		])
	)
	const Component = options.restoreMode
		? () => {
				useHook()
				return null
			}
		: load(formSource, {
				...imports,
				...fields,
				'@/features/auth/ui/AuthForm.module.scss': { default: {} },
				'@/features/auth/ui/auth-form/auth-toggle/AuthToggle': {
					default: () => null
				},
				'@/features/auth/ui/auth-form/social-media-buttons/SocialMediaButtons':
					{ default: () => null },
				'./LoginCodeFallback': { default: () => null },
				'@/features/auth/model/useAuthForm': { default: useHook },
				'@/features/auth/model/useAuthReturnUrl': {
					default: value => value
				}
			})
	const container = dom.window.document.getElementById('root')
	let root
	const render = async () => {
		root = createRoot(container)
		await act(async () =>
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client: queryClient },
					React.createElement(Component, { isLogin: false })
				)
			)
		)
	}
	await render()
	const flush = async () => {
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 5))
		})
	}
	t.after(async () => {
		await act(async () => root.unmount())
		queryClient.clear()
		Date.now = originalNow
		dom.window.close()
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else delete globalThis[key]
		}
	})
	return {
		calls,
		container,
		response,
		flush,
		get hook() {
			return latest
		},
		get: selector => container.querySelector(selector),
		button: text =>
			[...container.querySelectorAll('button')].find(button =>
				button.textContent.includes(text)
			),
		async change(name, value) {
			const input = container.querySelector(`input[name="${name}"]`)
			assert.ok(input)
			await act(async () => {
				Object.getOwnPropertyDescriptor(
					dom.window.HTMLInputElement.prototype,
					'value'
				).set.call(input, value)
				input.dispatchEvent(
					new dom.window.Event('input', { bubbles: true })
				)
			})
		},
		async submit(times = 1) {
			await act(async () => {
				for (let index = 0; index < times; index++)
					container.querySelector('form').dispatchEvent(
						new dom.window.Event('submit', {
							bubbles: true,
							cancelable: true
						})
					)
			})
		},
		async invoke(callback) {
			await act(callback)
		},
		async click(button) {
			assert.ok(button)
			await act(async () => button.click())
		},
		async advance(milliseconds) {
			clock += milliseconds
			await act(async () => {
				for (const callback of intervals.values()) callback()
			})
		},
		async remount() {
			await act(async () => root.unmount())
			await render()
		}
	}
}
async function fill(ui) {
	await ui.change('email', 'user@example.test')
	await ui.change('password', 'Synthetic9')
}

test('email registration fences double submit from CAPTCHA through HTTP, and submit/resend share the claim', async t => {
	const captcha = deferred(),
		send = deferred(),
		resend = deferred()
	const ui = await mount(t, {
		captcha: () => captcha.promise,
		send: () => send.promise,
		resend: () => resend.promise
	})
	await fill(ui)
	await ui.submit(2)
	assert.equal(ui.calls.captcha.length, 1)
	assert.equal(ui.hook.isLoading, true)
	assert.equal(ui.button('Телефон').disabled, true)
	await ui.invoke(async () => {
		captcha.resolve('token')
		await ui.flush()
	})
	assert.equal(ui.calls.send.length, 1)
	await ui.submit(2)
	assert.equal(ui.calls.send.length, 1)
	await ui.invoke(async () => {
		send.resolve(ui.response())
		await ui.flush()
	})
	assert.equal(ui.button('Повторить через 60 с').disabled, true)
	await ui.invoke(async () => {
		await ui.hook.resendEmailCode()
	})
	assert.equal(ui.calls.resend.length, 0)
	await ui.advance(60000)
	await ui.click(ui.button('Отправить код повторно'))
	await ui.change('code', '123456')
	await ui.submit()
	assert.equal(ui.calls.resend.length, 1)
	assert.equal(ui.calls.verify.length, 0)
	await ui.invoke(async () => {
		resend.resolve(ui.response())
		await ui.flush()
	})
	await ui.change('code', '123456')
	await ui.submit()
	await ui.flush()
	assert.deepEqual(ui.calls.verify[0][0], {
		email: 'user@example.test',
		code: '123456',
		referrerId: undefined
	})
	assert.deepEqual(ui.calls.auth, [true])
})

test('server resend time survives reload and only expiry re-enables explicit resend', async t => {
	const ui = await mount(t)
	await fill(ui)
	await ui.submit()
	await ui.flush()
	await ui.advance(17000)
	await ui.remount()
	assert.equal(ui.calls.send.length, 1)
	assert.equal(ui.button('Повторить через 43 с').disabled, true)
	await ui.advance(42000)
	assert.equal(ui.button('Повторить через 1 с').disabled, true)
	await ui.advance(1000)
	assert.equal(ui.button('Отправить код повторно').disabled, false)
	assert.equal(ui.calls.resend.length, 0)
})

test('timeout keeps an explicitly unknown code step and cooldown through reload, without automatic sends', async t => {
	const ui = await mount(t, {
		send: async () => {
			throw networkError()
		}
	})
	await fill(ui)
	await ui.submit()
	await ui.flush()
	assert.equal(ui.hook.isLoading, false)
	assert.equal(ui.get('input[name="email"]').disabled, true)
	assert.match(
		ui.container.textContent,
		/Отправку на user@example.test подтвердить не удалось/
	)
	assert.ok(ui.get('input[name="code"]'))
	assert.doesNotMatch(
		ui.calls.toast.join(' '),
		/undefined|Код подтверждения отправлен/
	)
	await ui.remount()
	assert.match(
		ui.container.textContent,
		/Отправку на user@example.test подтвердить не удалось/
	)
	assert.equal(ui.button('Повторить через 60 с').disabled, true)
	assert.equal(ui.calls.send.length, 1)
	assert.equal(ui.calls.resend.length, 0)
})

test('known email delivery failure preserves server cooldown and never claims sent', async t => {
	let failure
	const ui = await mount(t, {
		send: async () => {
			throw failure
		}
	})
	failure = {
		isAxiosError: true,
		response: {
			status: 502,
			data: {
				code: 'email_delivery_failed',
				message: 'Не удалось отправить письмо.',
				deliveryStatus: 'FAILED',
				expiresAt: ui.response().data.expiresAt,
				resendAvailableAt: new Date(Date.now() + 90000).toISOString()
			}
		}
	}
	await fill(ui)
	await ui.submit()
	await ui.flush()
	assert.match(
		ui.container.textContent,
		/Письмо на user@example.test не отправлено/
	)
	assert.equal(ui.button('Повторить через 90 с').disabled, true)
	await ui.remount()
	assert.match(
		ui.container.textContent,
		/Письмо на user@example.test не отправлено/
	)
	assert.equal(ui.button('Повторить через 90 с').disabled, true)
	assert.doesNotMatch(
		ui.calls.toast.join(' '),
		/Код подтверждения отправлен/
	)
})

test('CAPTCHA rejection releases the claim without dispatching or creating a pending registration', async t => {
	let unavailable = true
	const ui = await mount(t, {
		captcha: async () => {
			if (unavailable) throw new Error('Unavailable')
			return 'token'
		}
	})
	await fill(ui)
	await ui.submit(2)
	await ui.flush()
	assert.equal(ui.hook.isLoading, false)
	assert.equal(ui.calls.send.length, 0)
	assert.equal(ui.get('input[name="code"]'), null)
	unavailable = false
	await ui.submit()
	await ui.flush()
	assert.equal(ui.calls.send.length, 1)
})

test('blocked browser storage does not break send, verification, or the in-memory cooldown', async t => {
	const ui = await mount(t, { blockStorage: true })
	await fill(ui)
	await ui.submit()
	await ui.flush()
	assert.equal(ui.button('Повторить через 60 с').disabled, true)
	await ui.change('code', '123456')
	await ui.submit()
	await ui.flush()
	assert.equal(ui.calls.verify.length, 1)
	assert.deepEqual(ui.calls.auth, [true])
})

test('malformed saved registration does not lock or crash the form', async t => {
	const ui = await mount(t, {
		saved: '{"email":5,"expiresAt":"bad","resendAvailableAt":"bad"}'
	})
	assert.equal(ui.get('input[name="code"]'), null)
	await fill(ui)
	await ui.submit()
	await ui.flush()
	assert.equal(ui.calls.send.length, 1)
})

test('email password restore waits for one CAPTCHA/HTTP request and explains an unknown delivery outcome', async t => {
	const captcha = deferred(),
		restore = deferred()
	const ui = await mount(t, {
		restoreMode: true,
		captcha: () => captcha.promise,
		restore: () => restore.promise
	})
	let first, second
	await ui.invoke(async () => {
		first = ui.hook.onSubmit({ email: 'user@example.test' })
		second = ui.hook.onSubmit({ email: 'user@example.test' })
	})
	assert.equal(ui.calls.captcha.length, 1)
	assert.equal(ui.hook.isLoading, true)
	await ui.invoke(async () => {
		captcha.resolve('token')
		await ui.flush()
	})
	assert.equal(ui.calls.restore.length, 1)
	await ui.invoke(async () => {
		restore.reject(networkError())
		await Promise.all([first, second])
		await ui.flush()
	})
	assert.equal(ui.hook.isLoading, false)
	assert.equal(ui.calls.navigation.length, 0)
	assert.match(
		ui.calls.toast.join(' '),
		/Не удалось подтвердить отправку временного пароля/
	)
	assert.match(
		ui.calls.toast.join(' '),
		/прежний пароль остаётся действительным/
	)
})

test('email API requests preserve endpoints/payloads and have a timeout longer than SMTP hard deadline', async () => {
	const calls = []
	const client = {
		post: async (...args) => {
			calls.push(['post', ...args])
			return { data: {} }
		},
		patch: async (...args) => {
			calls.push(['patch', ...args])
			return { data: {} }
		}
	}
	const service = load(apiSource, {
		'@/shared/api': { axiosClassicRequest: client },
		'../model/login-otp.contract': {}
	})
	await service.sendEmailCode(
		{ email: 'user@example.test', password: 'Synthetic9' },
		'captcha'
	)
	await service.resendEmailCode({ email: 'user@example.test' }, 'captcha')
	await service.registerByEmail(
		{ email: 'user@example.test', code: '123456' },
		'captcha'
	)
	await service.getRestorePassword(
		{ email: 'user@example.test' },
		'captcha'
	)
	assert.deepEqual(
		calls.map(call => call[1]),
		[
			'/auth/register',
			'/auth/email/resend-code',
			'/auth/email/register',
			'/auth/restore-password'
		]
	)
	assert.deepEqual(calls[0][2], {
		email: 'user@example.test',
		password: 'Synthetic9'
	})
	for (const call of calls)
		assert.deepEqual(call[3], {
			timeout: 45000,
			headers: { recaptcha: 'captcha' }
		})
})

test('an unknown resend clears the old entered code, uses server timing and remains unknown after reload', async t => {
	let failure
	const ui = await mount(t, {
		resend: async () => {
			throw failure
		}
	})
	await fill(ui)
	await ui.submit()
	await ui.flush()
	await ui.change('code', '123456')
	await ui.advance(60000)
	failure = {
		isAxiosError: true,
		response: {
			status: 502,
			data: {
				code: 'email_delivery_unknown',
				deliveryStatus: 'UNKNOWN',
				message: 'Результат отправки неизвестен.',
				expiresAt: ui.response().data.expiresAt,
				resendAvailableAt: new Date(Date.now() + 75000).toISOString()
			}
		}
	}
	await ui.click(ui.button('Отправить код повторно'))
	await ui.flush()
	assert.equal(ui.get('input[name="code"]').value, '')
	assert.equal(ui.button('Повторить через 75 с').disabled, true)
	assert.match(
		ui.container.textContent,
		/Отправку на user@example.test подтвердить не удалось/
	)
	await ui.remount()
	assert.equal(ui.button('Повторить через 75 с').disabled, true)
	assert.match(
		ui.container.textContent,
		/Отправку на user@example.test подтвердить не удалось/
	)
	assert.equal(ui.calls.resend.length, 1)
})

test('server CAPTCHA outage never creates a pending email registration', async t => {
	const ui = await mount(t, {
		send: async () => {
			throw {
				isAxiosError: true,
				response: {
					status: 503,
					data: {
						code: 'recaptcha_unavailable',
						message: 'Капча недоступна.'
					}
				}
			}
		}
	})
	await fill(ui)
	await ui.submit()
	await ui.flush()
	assert.equal(ui.get('input[name="code"]'), null)
	assert.equal(ui.get('input[name="email"]').disabled, false)
	assert.equal(ui.hook.isLoading, false)
	assert.match(ui.calls.toast.join(' '), /Капча недоступна/)
})

test('unknown verification does not authenticate, discard entered code, or send automatically', async t => {
	const ui = await mount(t, {
		verify: async () => {
			throw networkError()
		}
	})
	await fill(ui)
	await ui.submit()
	await ui.flush()
	await ui.change('code', '123456')
	await ui.submit()
	await ui.flush()
	assert.equal(ui.get('input[name="code"]').value, '123456')
	assert.deepEqual(ui.calls.auth, [])
	assert.deepEqual(ui.calls.navigation, [])
	assert.equal(ui.calls.send.length, 1)
	assert.equal(ui.calls.resend.length, 0)
	assert.match(
		ui.container.textContent,
		/Не удалось подтвердить результат проверки/
	)
})

test('exhausted email guesses block resend until the server deadline, including after reload beyond the original expiry', async t => {
	const ui = await mount(t, {
		verify: async () => {
			const deadline = new Date(Date.now() + 600_000).toISOString()
			throw {
				isAxiosError: true,
				response: {
					status: 401,
					data: {
						code: 'email_code_attempts_exceeded',
						message:
							'Лимит попыток исчерпан. Запросите новый код после завершения текущей проверки.',
						expiresAt: deadline,
						resendAvailableAt: deadline
					}
				}
			}
		}
	})
	await fill(ui)
	await ui.submit()
	await ui.flush()
	await ui.advance(60_000)
	await ui.change('code', '123456')
	await ui.submit()
	await ui.flush()
	assert.equal(ui.button('Повторить через 600 с').disabled, true)
	assert.match(
		ui.container.textContent,
		/Новый код можно запросить после окончания таймера/
	)
	assert.equal(ui.get('input[name="code"]').value, '123456')
	await ui.invoke(async () => ui.hook.resendEmailCode())
	assert.equal(ui.calls.resend.length, 0)
	assert.deepEqual(ui.calls.auth, [])
	// Another tab may have extended the challenge; persist both server dates.
	await ui.advance(540_001)
	await ui.remount()
	assert.equal(ui.button('Повторить через 60 с').disabled, true)
	assert.equal(ui.get('input[name="email"]').disabled, true)
	await ui.invoke(async () => ui.hook.resendEmailCode())
	assert.equal(ui.calls.resend.length, 0)
	await ui.advance(59_999)
	await ui.click(ui.button('Отправить код повторно'))
	await ui.flush()
	assert.equal(ui.calls.resend.length, 1)
})

for (const code of ['email_code_not_found', 'user_already_exists']) {
	test(`registration still resets its pending step for ${code}`, async t => {
		const ui = await mount(t, {
			verify: async () => {
				throw {
					isAxiosError: true,
					response: {
						status: 400,
						data: { code, message: 'Проверка отклонена.' }
					}
				}
			}
		})
		await fill(ui)
		await ui.submit()
		await ui.flush()
		await ui.change('code', '123456')
		await ui.submit()
		await ui.flush()
		assert.equal(ui.get('input[name="code"]'), null)
		assert.equal(ui.get('input[name="email"]').disabled, false)
		await ui.remount()
		assert.equal(ui.get('input[name="code"]'), null)
		assert.equal(ui.calls.send.length, 1)
	})
}
