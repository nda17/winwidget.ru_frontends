import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
// Reuse the installed test dependency, keeping the application on React 18.
const { JSDOM } = createRequire(
	new URL('../apps/crm/package.json', import.meta.url)
)('jsdom')
const sources = await Promise.all(
	[
		'packages/winwidget-web/src/features/bind-profile-identity/model/useProfileIdentityBinding.ts',
		'apps/widgets/src/screens/cabinet/ui/CabinetProfile.tsx',
		'apps/widgets/src/screens/payment/ui/pricing/Pricing.tsx'
	].map(
		async path =>
			ts.transpileModule(
				await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
				{
					fileName: path,
					compilerOptions: {
						module: ts.ModuleKind.CommonJS,
						target: ts.ScriptTarget.ES2022,
						jsx: ts.JsxEmit.ReactJSX
					}
				}
			).outputText
	)
)
const deferred = () => {
	let resolve, reject
	const promise = new Promise((ok, fail) => {
		resolve = ok
		reject = fail
	})
	return { promise, resolve, reject }
}

async function mountBinding(t, options = {}) {
	const dom = new JSDOM('<div id="root"></div>', {
		url: 'https://winwidget.test/cabinet'
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
			configurable: true,
			writable: true,
			value
		})
	}
	const React = require('react')
	assert.match(React.version, /^18\./)
	const { act } = React
	const { createRoot } = require('react-dom/client')
	const query = require('@tanstack/react-query')
	const queryClient = new query.QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Infinity },
			mutations: { retry: false, gcTime: Infinity }
		}
	})
	let clock = Date.now()
	const originalNow = Date.now
	Date.now = () => clock
	let nextInterval = 0
	const intervals = new Map()
	dom.window.setInterval = callback => {
		intervals.set(++nextInterval, callback)
		return nextInterval
	}
	dom.window.clearInterval = id => intervals.delete(id)
	const calls = {
		send: [],
		verify: [],
		toast: [],
		windows: [],
		payment: []
	}
	dom.window.open = () => {
		const popup = { close: () => (popup.closed = true), closed: false }
		calls.windows.push(popup)
		return popup
	}
	const response = (value = 'first@example.test', seconds = 60) => ({
		data: {
			value,
			expiresAt: new Date(clock + 600_000).toISOString(),
			resendAvailableAt: new Date(clock + seconds * 1000).toISOString()
		}
	})
	const service = {
		sendProfileEmailCode: async data => {
			calls.send.push(data)
			return options.send ? options.send(data) : response(data.email)
		},
		verifyProfileEmailCode: async data => {
			calls.verify.push(data)
			return options.verify?.(data)
		},
		fetchProfileTelegramNotifications: async () => ({ connected: false })
	}
	const toast = message => calls.toast.push(message)
	toast.loading = toast.success = toast.error = toast
	const imports = {
		'@/shared/api': {
			errorCatch: error => error?.response?.data?.message || error?.message
		},
		'@/entities/user': {
			userService: service,
			useUser: () => ({
				user: { id: 'user-1', loginMethods: ['TELEGRAM'] },
				isLoading: false
			}),
			useAuthStore: selector => selector({ auth: true })
		},
		'@tanstack/react-query': query,
		axios: require('axios'),
		react: React,
		'react/jsx-runtime': require('react/jsx-runtime'),
		'react-hook-form': require('react-hook-form'),
		'react-hot-toast': { default: toast },
		'@/features/edit-profile': {
			useProfileEdit: () => ({
				onSubmit: async () => true,
				isLoading: false
			})
		},
		'@/features/upload-file': { FieldUploadFile: () => null },
		'@/shared/ui/icons/AppIcon': { default: () => null },
		'@/shared/ui/skeleton-loader/SkeletonLoader': { default: () => null },
		'@/shared/lib/hooks/usePhoneMask': {
			usePhoneMask: () => ({ isMaskEmpty: true, reset() {} })
		},
		'@/shared/regex': {
			validEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
			validPhoneCode: /^\d{6}$/,
			validName: /.+/,
			validPassword: /.+/,
			validPhone: /^\+7\d{10}$/
		},
		'@/entities/subscription': {
			subscriptionService: {
				getMySubscription: async () => null,
				getPendingPayment: async () => null,
				createPayment: (...args) => calls.payment.push(args)
			},
			tariffPricesService: { get: async () => [] },
			createTariffPriceMap: () => ({
				EASY: { MONTHLY: 100, YEARLY: 1000 }
			})
		},
		'@/shared/config/pages/public.config': {
			PUBLIC_PAGES: { LOGIN: '/login' }
		},
		'@/shared/lib/navigation/ZoneLink': { default: () => null },
		'@/shared/lib/navigation/useZoneRouter': {
			useZoneRouter: () => ({ push() {} })
		},
		'./CrmPricingCards': { default: () => null },
		'./Pricing.module.scss': { default: {} },
		'./Cabinet.module.scss': { default: {} }
	}
	const load = source => {
		const loadedModule = { exports: {} }
		new Function('exports', 'module', 'require', source)(
			loadedModule.exports,
			loadedModule,
			name => {
				assert.ok(
					Object.hasOwn(imports, name),
					`Unexpected import ${name}`
				)
				return imports[name]
			}
		)
		return loadedModule.exports
	}
	const binding = load(sources[0])
	imports['@/features/bind-profile-identity'] = binding
	let api
	const Hook = () => {
		api = binding.useProfileIdentityBinding()
		return null
	}
	const Component =
		options.screen === 'profile'
			? load(sources[1]).default
			: options.screen === 'payment'
				? load(sources[2]).default
				: Hook
	const container = dom.window.document.getElementById('root')
	const root = createRoot(container)
	await act(async () => {
		root.render(
			React.createElement(
				query.QueryClientProvider,
				{ client: queryClient },
				React.createElement(Component, { pricingContent: { plans: [] } })
			)
		)
	})
	const flush = async () => {
		await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
	}
	await flush()
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
		get api() {
			return api
		},
		calls,
		response,
		container,
		act,
		flush,
		async advance(ms) {
			await act(async () => {
				clock += ms
				for (const callback of [...intervals.values()]) callback()
			})
		},
		input: placeholder =>
			container.querySelector(`input[placeholder="${placeholder}"]`),
		button: text =>
			[...container.querySelectorAll('button')].find(
				button => button.textContent === text
			),
		async change(input, value) {
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
		async click(button, twice = false) {
			assert.ok(button, 'Expected button exists')
			await act(async () => {
				button.click()
				if (twice) button.click()
			})
			await flush()
		}
	}
}

test('email binding fences concurrent operations and verifies the captured address', async t => {
	const send = deferred()
	const verify = deferred()
	const ui = await mountBinding(t, {
		send: () => send.promise,
		verify: () => verify.promise
	})
	let first
	await ui.act(async () => {
		first = ui.api.requestEmailCode(' FIRST@EXAMPLE.TEST ')
		assert.equal(
			await ui.api.requestEmailCode('second@example.test'),
			false
		)
		assert.equal(
			await ui.api.confirmEmailCode({
				email: 'first@example.test',
				code: '123456'
			}),
			false
		)
	})
	assert.equal(ui.calls.send.length, 1)
	await ui.act(async () => {
		send.resolve(ui.response())
		await first
	})
	assert.equal(ui.api.requestedEmail, 'first@example.test')
	assert.equal(ui.api.emailResendSeconds, 60)
	assert.equal(
		await ui.api.confirmEmailCode({
			email: 'second@example.test',
			code: '123456'
		}),
		false
	)
	let confirmation
	await ui.act(async () => {
		confirmation = ui.api.confirmEmailCode({
			email: 'first@example.test',
			code: '123456'
		})
		assert.equal(
			await ui.api.confirmEmailCode({
				email: 'first@example.test',
				code: '123456'
			}),
			false
		)
		ui.api.resetEmailBinding()
	})
	assert.equal(ui.api.requestedEmail, 'first@example.test')
	assert.deepEqual(ui.calls.verify, [
		{ email: 'first@example.test', code: '123456' }
	])
	await ui.act(async () => {
		verify.resolve({})
		await confirmation
	})
	assert.equal(ui.api.emailCodeRequested, false)
})

test('email binding respects server cooldown, including after editing the contact', async t => {
	const ui = await mountBinding(t)
	await ui.act(async () => {
		await ui.api.requestEmailCode('first@example.test')
	})
	await ui.act(async () => ui.api.resetEmailBinding())
	assert.equal(ui.api.requestedEmail, '')
	assert.equal(await ui.api.requestEmailCode('second@example.test'), false)
	await ui.advance(59_001)
	assert.equal(ui.api.emailResendSeconds, 1)
	await ui.advance(999)
	assert.equal(ui.api.emailResendSeconds, 0)
	await ui.act(async () => {
		await ui.api.requestEmailCode('second@example.test')
	})
	assert.equal(ui.calls.send.length, 2)
})

for (const kind of ['network', 'unknown']) {
	test(`${kind} send result keeps code entry without claiming delivery`, async t => {
		const ui = await mountBinding(t, {
			send: async () => {
				throw {
					isAxiosError: true,
					...(kind === 'unknown'
						? {
								response: {
									data: {
										code: 'email_delivery_unknown',
										resendAvailableAt: new Date(
											Date.now() + 12_000
										).toISOString()
									}
								}
							}
						: {})
				}
			}
		})
		await ui.act(async () => {
			assert.equal(
				await ui.api.requestEmailCode('first@example.test'),
				false
			)
		})
		assert.equal(ui.api.emailCodeRequested, true)
		assert.equal(ui.api.emailDeliveryUncertain, true)
		assert.equal(ui.api.requestedEmail, 'first@example.test')
		assert.equal(ui.api.emailResendSeconds, kind === 'network' ? 60 : 12)
		assert.match(ui.calls.toast.at(-1), /Письмо могло отправиться/)
		await ui.act(async () => {
			await ui.api.confirmEmailCode({
				email: 'first@example.test',
				code: '123456'
			})
		})
		assert.equal(ui.calls.verify.length, 1)
	})
}

test('known send failure preserves the previous challenge and honors server retry time', async t => {
	let fail = false
	const ui = await mountBinding(t, {
		send: async () => {
			if (!fail) return ui.response()
			throw {
				isAxiosError: true,
				response: {
					data: {
						code: 'email_delivery_failed',
						message: 'Не удалось отправить письмо',
						resendAvailableAt: new Date(Date.now() + 25_000).toISOString()
					}
				}
			}
		}
	})
	await ui.act(async () => {
		await ui.api.requestEmailCode('first@example.test')
	})
	await ui.advance(60_000)
	fail = true
	await ui.act(async () => {
		assert.equal(
			await ui.api.requestEmailCode('first@example.test'),
			false
		)
	})
	assert.equal(ui.api.requestedEmail, 'first@example.test')
	assert.equal(ui.api.emailDeliveryUncertain, false)
	assert.equal(ui.api.emailResendSeconds, 25)
})

test('profile email stays locked to the sent address and exposes a disabled resend countdown', async t => {
	const ui = await mountBinding(t, { screen: 'profile' })
	await ui.change(ui.input('Email'), 'first@example.test')
	await ui.click(ui.button('Привязать email'), true)
	assert.equal(ui.calls.send.length, 1)
	assert.equal(ui.input('Email').readOnly, true)
	assert.match(
		ui.container.textContent,
		/Код отправлен на first@example.test/
	)
	assert.equal(ui.button('Повторить через 60 с').disabled, true)
	await ui.change(ui.input('Код из email'), '123456')
	await ui.click(ui.button('Подтвердить'), true)
	assert.deepEqual(ui.calls.verify, [
		{ email: 'first@example.test', code: '123456' }
	])
})

for (const screen of ['profile', 'payment']) {
	test(`${screen} honors the exhausted email guess deadline from verification before enabling resend`, async t => {
		const ui = await mountBinding(t, {
			screen,
			verify: async () => {
				const deadline = new Date(Date.now() + 420_000).toISOString()
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
		await ui.change(
			ui.input(screen === 'profile' ? 'Email' : 'Email для оплаты'),
			'first@example.test'
		)
		await ui.click(
			ui.button(screen === 'profile' ? 'Привязать email' : 'Получить код')
		)
		await ui.advance(60_000)
		await ui.change(ui.input('Код из email'), '123456')
		await ui.click(
			ui.button(
				screen === 'profile' ? 'Подтвердить' : 'Подтвердить и оплатить'
			)
		)
		assert.equal(ui.calls.verify.length, 1)
		assert.equal(ui.button('Повторить через 420 с').disabled, true)
		assert.match(
			ui.calls.toast.at(-1),
			/Новый код можно запросить после окончания таймера/
		)
		await ui.click(ui.button('Повторить через 420 с'))
		assert.equal(ui.calls.send.length, 1)
		assert.equal(ui.calls.payment.length, 0)
		await ui.advance(419_999)
		assert.equal(ui.button('Повторить через 1 с').disabled, true)
		await ui.advance(1)
		await ui.click(ui.button('Отправить повторно'))
		assert.equal(ui.calls.send.length, 2)
	})
}

test('payment email confirmation opens one window and closes it on a failed verification', async t => {
	const verify = deferred()
	const ui = await mountBinding(t, {
		screen: 'payment',
		verify: () => verify.promise
	})
	await ui.change(ui.input('Email для оплаты'), 'first@example.test')
	await ui.click(ui.button('Получить код'), true)
	assert.equal(ui.calls.send.length, 1)
	assert.equal(ui.input('Email для оплаты').disabled, true)
	assert.equal(ui.button('Повторить через 60 с').disabled, true)
	await ui.change(ui.input('Код из email'), '123456')
	await ui.click(ui.button('Подтвердить и оплатить'), true)
	assert.equal(ui.calls.windows.length, 1)
	assert.equal(ui.calls.verify.length, 1)
	await ui.act(async () => verify.reject({ isAxiosError: true }))
	await ui.flush()
	assert.equal(ui.calls.windows[0].closed, true)
	assert.equal(ui.calls.payment.length, 0)
	assert.match(ui.calls.toast.at(-1), /Email мог быть подтверждён/)
})

for (const status of [502, 503, 504]) {
	test(`unstructured gateway ${status} keeps email code entry with unknown delivery and a retry cooldown`, async t => {
		const ui = await mountBinding(t, {
			send: async () => {
				throw {
					isAxiosError: true,
					response: { status, data: '<html>Gateway unavailable</html>' }
				}
			}
		})
		await ui.act(async () => {
			assert.equal(
				await ui.api.requestEmailCode('first@example.test'),
				false
			)
		})
		assert.equal(ui.api.emailCodeRequested, true)
		assert.equal(ui.api.emailDeliveryUncertain, true)
		assert.equal(ui.api.requestedEmail, 'first@example.test')
		assert.equal(ui.api.emailResendSeconds, 60)
		assert.match(ui.calls.toast.at(-1), /Письмо могло отправиться/)
		await ui.act(async () => {
			assert.equal(
				await ui.api.requestEmailCode('first@example.test'),
				false
			)
			await ui.api.confirmEmailCode({
				email: 'first@example.test',
				code: '123456'
			})
		})
		assert.equal(ui.calls.send.length, 1)
		assert.equal(ui.calls.verify.length, 1)
	})
}
