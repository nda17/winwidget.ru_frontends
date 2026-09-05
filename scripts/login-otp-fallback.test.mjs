import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

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

const contract = { exports: {} }
vm.runInNewContext(await compile('model/login-otp.contract.ts'), {
	exports: contract.exports
})
const { parseLoginOtpCapabilities, parseLoginOtpChallenge } =
	contract.exports

test('OTP capability parser accepts only explicit ready channels and exact contract', () => {
	const ready = {
		available: true,
		channels: ['EMAIL', 'SMS'],
		codeLength: 6,
		expiresInSeconds: 300,
		resendAfterSeconds: 60
	}
	assert.equal(parseLoginOtpCapabilities(ready), ready)
	assert.equal(
		parseLoginOtpCapabilities({ ...ready, available: false, channels: [] })
			.available,
		false
	)
	for (const change of [
		{ channels: ['SMS', 'SMS'] },
		{ channels: ['TELEGRAM'] },
		{ channels: [] },
		{ available: false },
		{ codeLength: 4 },
		{ resendAfterSeconds: 0 },
		{ secret: 'unexpected' }
	]) {
		assert.throws(() => parseLoginOtpCapabilities({ ...ready, ...change }))
	}
	for (const value of [null, [], {}, 'enabled'])
		assert.throws(() => parseLoginOtpCapabilities(value))
})

test('OTP challenge parser rejects cross-purpose DTOs and invalid time/token bindings', () => {
	const value = {
		challengeId: '11111111-1111-4111-8111-111111111111',
		browserToken: 'a'.repeat(43),
		expiresAt: '2026-09-05T10:05:00.000Z',
		resendAvailableAt: '2026-09-05T10:01:00.000Z'
	}
	assert.equal(parseLoginOtpChallenge(value), value)
	for (const change of [
		{ browserToken: 'short' },
		{ browserToken: '/'.repeat(43) },
		{ challengeId: 'account-id' },
		{ expiresAt: 'invalid' },
		{ expiresAt: '2026-02-31T10:05:00.000Z' },
		{ resendAvailableAt: '2026-09-05 10:01:00' },
		{ resendAvailableAt: value.expiresAt },
		{ expiresAt: '2026-09-05T10:00:00.000Z' },
		{ code: '123456' }
	]) {
		assert.throws(() => parseLoginOtpChallenge({ ...value, ...change }))
	}
})

const loaderSource = await compile('model/recaptcha-client.ts')
const setup = (foreign = false) => {
	const timers = new Map()
	let nextTimer = 0
	const scripts = []
	const createScript = () => {
		const events = new Map()
		const script = {
			removed: false,
			events,
			addEventListener: (name, callback) => events.set(name, callback),
			removeEventListener: name => events.delete(name),
			remove: () => {
				script.removed = true
			},
			emit: name => events.get(name)?.()
		}
		return script
	}
	if (foreign) scripts.push(createScript())
	const window = {
		setTimeout: callback => {
			timers.set(++nextTimer, callback)
			return nextTimer
		},
		clearTimeout: id => timers.delete(id)
	}
	const exports = {}
	vm.runInNewContext(loaderSource, {
		exports,
		window,
		URLSearchParams,
		process: { env: {} },
		document: {
			querySelector: () => scripts.find(script => !script.removed) ?? null,
			createElement: createScript,
			head: { appendChild: script => scripts.push(script) }
		}
	})
	return {
		api: exports,
		scripts,
		window,
		timers,
		expire: () => {
			for (const callback of [...timers.values()]) callback()
		}
	}
}

test('CAPTCHA script shares one load, bounds outages, and removes only its own failed node', async () => {
	const state = setup()
	const pending = state.api.loadRecaptchaScript('test-key')
	assert.equal(state.api.loadRecaptchaScript('test-key'), pending)
	assert.equal(state.scripts.length, 1)
	const rejected = assert.rejects(pending, {
		name: 'RecaptchaUnavailableError'
	})
	state.expire()
	await rejected
	assert.equal(state.scripts[0].removed, true)
	assert.equal(state.scripts[0].events.size, 0)
	const retry = state.api.loadRecaptchaScript('test-key')
	assert.equal(state.scripts.length, 2)
	state.window.grecaptcha = {
		ready: callback => callback(),
		execute: async () => 'test-token'
	}
	state.scripts[1].emit('load')
	await retry
	await state.api.waitForRecaptchaReady()
	assert.equal(
		await state.api.executeRecaptchaToken('test-key', 'login'),
		'test-token'
	)
})

test('CAPTCHA leaves foreign scripts untouched when load fails', async () => {
	const state = setup(true)
	const pending = state.api.loadRecaptchaScript('test-key')
	const rejected = assert.rejects(pending, {
		name: 'RecaptchaUnavailableError'
	})
	state.scripts[0].emit('error')
	await rejected
	assert.equal(state.scripts[0].removed, false)
	assert.equal(state.scripts[0].events.size, 0)
})

test('CAPTCHA ready/execute stalls and empty tokens fail without an unbounded form spinner', async () => {
	for (const phase of ['ready', 'execute', 'empty', 'reject']) {
		const state = setup()
		state.window.grecaptcha = {
			ready: () => {},
			execute: () =>
				phase === 'empty'
					? Promise.resolve('')
					: phase === 'reject'
						? Promise.reject(new Error('provider private diagnostic'))
						: new Promise(() => {})
		}
		const pending =
			phase === 'ready'
				? state.api.waitForRecaptchaReady()
				: state.api.executeRecaptchaToken('test', 'login')
		const rejected = assert.rejects(
			pending,
			error =>
				error.name === 'RecaptchaUnavailableError' &&
				!error.message.includes('private')
		)
		await Promise.resolve()
		state.expire()
		await rejected
	}
})

test('OTP uses its own login routes, no registration-code reuse or browser persistence', async () => {
	const api = await readFile(new URL('api/auth.api.ts', base), 'utf8')
	const ui = await readFile(
		new URL('ui/auth-form/LoginCodeFallback.tsx', base),
		'utf8'
	)
	const hook = await readFile(
		new URL('model/useAuthForm.ts', base),
		'utf8'
	)
	assert.match(api, /\/auth\/login-otp\/capabilities/)
	assert.match(api, /\/auth\/login-otp\/request/)
	assert.match(api, /\/auth\/login-otp\/verify/)
	assert.doesNotMatch(
		ui,
		/localStorage|sessionStorage|document\.cookie|console\./
	)
	assert.doesNotMatch(
		ui,
		/registerByEmail|registerByPhone|sendPhoneCode|sendEmailCode/
	)
	assert.match(ui, /requestRetryNotBefore = Date\.now\(\) \+ 60000/)
	assert.match(ui, /inflight\.current/)
	assert.match(ui, /retry: false/)
	assert.match(ui, /autoComplete="one-time-code"/)
	assert.match(
		hook,
		/error\.response\?\.status === 503[\s\S]*?recaptcha_unavailable/
	)
})

// Reuse the already installed test-only jsdom dependency from the workspace.
// The UI itself runs with the main frontend's React 18 and React Query; no CRM
// runtime code or React 19 modules are loaded into the Widgets application.
const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(
	new URL('../apps/crm/package.json', import.meta.url)
)('jsdom')
const uiSource = await compile('ui/auth-form/LoginCodeFallback.tsx')
const capability = (channels = ['EMAIL', 'SMS']) => ({
	available: channels.length > 0,
	channels,
	codeLength: 6,
	expiresInSeconds: 300,
	resendAfterSeconds: 60
})
const deferred = () => {
	let resolve, reject
	const promise = new Promise((ok, fail) => {
		resolve = ok
		reject = fail
	})
	return { promise, resolve, reject }
}
async function mountOtp(t, options = {}) {
	const dom = new JSDOM(
		'<!doctype html><html><body><div id="test-root"></div></body></html>',
		{ url: 'https://winwidget.test/login' }
	)
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
	const {
		QueryClient,
		QueryClientProvider,
		useQuery
	} = require('@tanstack/react-query')
	const calls = {
		request: [],
		verify: [],
		authenticated: 0,
		retryCaptcha: 0,
		toast: []
	}
	let clock = Date.now()
	const originalNow = Date.now
	Date.now = () => clock
	const intervals = new Map()
	let timerId = 0
	dom.window.setInterval = callback => {
		intervals.set(++timerId, callback)
		return timerId
	}
	dom.window.clearInterval = id => intervals.delete(id)
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: Infinity } }
	})
	queryClient.setQueryData(
		['login-otp-capabilities'],
		options.capabilities ?? capability()
	)
	const challenge = suffix => ({
		challengeId: `11111111-1111-4111-8111-${String(suffix ?? 1).padStart(12, '0')}`,
		browserToken: 'A'.repeat(43),
		expiresAt: new Date(clock + 300000).toISOString(),
		resendAvailableAt: new Date(clock + 60000).toISOString()
	})
	const service = {
		loginOtpCapabilities: async () => options.capabilities ?? capability(),
		requestLoginOtp: async (...args) => {
			calls.request.push(args)
			return options.request
				? options.request(...args)
				: challenge(calls.request.length)
		},
		verifyLoginOtp: async (...args) => {
			calls.verify.push(args)
			return options.verify?.(...args)
		}
	}
	const toast = message => calls.toast.push(message)
	toast.error = toast
	toast.success = toast
	const imports = {
		'../../api/auth.api': { default: service },
		'./auth-toggle/AuthToggle': { default: () => null },
		'../AuthForm.module.scss': { default: {} },
		'@/shared/lib/phone': {
			PHONE_INPUT_MAX_LENGTH: 18,
			PHONE_INPUT_PLACEHOLDER: '+7 (999) 123-45-67',
			formatPhoneInput: value => value,
			parsePhoneInput: value => (/^\+7\d{10}$/.test(value) ? value : null)
		},
		'@/shared/regex': { validEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
		'@tanstack/react-query': { useQuery },
		axios: {
			default: { isAxiosError: value => value?.isAxiosError === true }
		},
		react: React,
		'react-hot-toast': { default: toast },
		'react/jsx-runtime': require('react/jsx-runtime')
	}
	const module = { exports: {} }
	new Function('exports', 'module', 'require', uiSource)(
		module.exports,
		module,
		name => {
			if (!Object.hasOwn(imports, name))
				throw new Error(`Unexpected UI import: ${name}`)
			return imports[name]
		}
	)
	const Component = module.exports.default
	const container = dom.window.document.getElementById('test-root')
	let root
	const render = async () => {
		root = createRoot(container)
		await act(async () =>
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client: queryClient },
					React.createElement(Component, {
						onAuthenticated: () => calls.authenticated++,
						onRetryCaptcha: () => calls.retryCaptcha++
					})
				)
			)
		)
	}
	const flush = async () => {
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 5))
		})
	}
	await render()
	t.after(async () => {
		if (root) await act(async () => root.unmount())
		queryClient.clear()
		Date.now = originalNow
		dom.window.close()
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else delete globalThis[key]
		}
	})
	return {
		container,
		calls,
		challenge,
		flush,
		get: selector => container.querySelector(selector),
		button: text =>
			[...container.querySelectorAll('button')].find(button =>
				button.textContent.includes(text)
			),
		async change(selector, value) {
			const input = container.querySelector(selector)
			assert.ok(input, `Missing input ${selector}`)
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
		async click(element) {
			assert.ok(element)
			await act(async () => element.click())
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
		async advance(milliseconds) {
			clock += milliseconds
			await act(async () => {
				for (const callback of intervals.values()) callback()
			})
		},
		async capabilities(value) {
			await act(async () =>
				queryClient.setQueryData(['login-otp-capabilities'], value)
			)
			await flush()
		},
		async remount() {
			await act(async () => root.unmount())
			await render()
		},
		async unmount() {
			await act(async () => root.unmount())
			root = null
		}
	}
}

test('React 18 OTP form never auto-sends, normalizes email and fences concurrent explicit submissions', async t => {
	const pending = deferred()
	const ui = await mountOtp(t, { request: () => pending.promise })
	assert.equal(ui.calls.request.length, 0)
	await ui.change('input[type=email]', 'User@Example.test')
	await ui.submit(2)
	assert.deepEqual(ui.calls.request, [['EMAIL', 'user@example.test']])
	assert.equal(ui.get('input[type=email]').disabled, true)
	assert.equal(ui.button('паролем').disabled, true)
	pending.resolve(ui.challenge())
	await ui.flush()
	assert.equal(ui.calls.request.length, 1)
	assert.equal(ui.get('input[autocomplete="one-time-code"]').value, '')
	assert.match(ui.container.textContent, /Проверяйте также папку «Спам»/)
	assert.equal(ui.calls.authenticated, 0)
})

test('React 18 unknown resend outcome discards the old challenge and preserves cooldown across remount', async t => {
	let attempts = 0
	let ui
	ui = await mountOtp(t, {
		request: async () => {
			if (++attempts > 1) throw new Error('synthetic transport timeout')
			return ui.challenge()
		}
	})
	await ui.change('input[type=email]', 'user@example.test')
	await ui.submit()
	await ui.advance(61000)
	await ui.click(ui.button('Отправить код повторно'))
	assert.equal(ui.calls.request.length, 2)
	assert.equal(ui.get('input[autocomplete="one-time-code"]'), null)
	assert.match(ui.container.textContent, /Не удалось подтвердить отправку/)
	await ui.remount()
	await ui.change('input[type=email]', 'another@example.test')
	assert.equal(ui.get('button[type=submit]').disabled, true)
	await ui.submit()
	assert.equal(ui.calls.request.length, 2)
	await ui.advance(61000)
	assert.equal(ui.get('button[type=submit]').disabled, false)
	assert.equal(ui.calls.request.length, 2)
})

test('React 18 channel changes clear the destination and withdrawn capabilities block new sends', async t => {
	const ui = await mountOtp(t)
	await ui.change('input[type=email]', 'user@example.test')
	await ui.click(ui.get('input[type=radio][value=SMS]'))
	assert.equal(ui.get('input[type=tel]').value, '')
	await ui.change('input[type=tel]', '+79991234567')
	await ui.submit()
	assert.deepEqual(ui.calls.request, [['SMS', '+79991234567']])
	assert.doesNotMatch(ui.container.textContent, /Спам/)
	await ui.advance(61000)
	await ui.capabilities(capability(['EMAIL']))
	assert.equal(ui.button('Отправить код повторно').disabled, true)
	assert.match(ui.container.textContent, /Код из SMS/)
	assert.doesNotMatch(ui.container.textContent, /Спам/)
	await ui.change('input[autocomplete="one-time-code"]', '123456')
	await ui.submit()
	assert.equal(ui.calls.verify.length, 1)
	assert.equal(ui.calls.authenticated, 1)
	assert.equal(ui.calls.request.length, 1)
})

test('React 18 malformed/expired codes never verify and contact edits retain the send limit', async t => {
	const ui = await mountOtp(t)
	await ui.change('input[type=email]', 'user@example.test')
	await ui.submit()
	await ui.change('input[autocomplete="one-time-code"]', '12x34')
	assert.equal(ui.get('input[autocomplete="one-time-code"]').value, '1234')
	await ui.submit()
	assert.equal(ui.calls.verify.length, 0)
	await ui.click(ui.button('Изменить контакт'))
	await ui.change('input[type=email]', 'other@example.test')
	await ui.submit()
	assert.equal(ui.calls.request.length, 1)
	await ui.advance(61000)
	await ui.submit()
	await ui.advance(301000)
	assert.equal(
		ui.get('input[autocomplete="one-time-code"]').disabled,
		true
	)
	await ui.submit()
	assert.equal(ui.calls.verify.length, 0)
	assert.match(ui.container.textContent, /Срок действия кода истёк/)
})

test('React 18 verification uses the exact challenge once and ignores completion after unmount', async t => {
	const pending = deferred()
	const ui = await mountOtp(t, { verify: () => pending.promise })
	await ui.change('input[type=email]', 'user@example.test')
	await ui.submit()
	await ui.change('input[autocomplete="one-time-code"]', '123456')
	await ui.submit(2)
	assert.equal(ui.calls.verify.length, 1)
	assert.deepEqual(ui.calls.verify[0], [ui.challenge(), '123456'])
	assert.equal(
		ui.get('input[autocomplete="one-time-code"]').disabled,
		true
	)
	await ui.unmount()
	pending.resolve()
	await ui.flush()
	assert.equal(ui.calls.authenticated, 0)
})

test('React 18 unavailable or failed capabilities expose retry/password recovery without OTP requests', async t => {
	const ui = await mountOtp(t, { capabilities: capability([]) })
	assert.equal(ui.get('input'), null)
	await ui.click(ui.button('Проверить доступность'))
	assert.equal(ui.calls.request.length, 0)
	await ui.click(ui.button('паролем'))
	assert.equal(ui.calls.retryCaptcha, 1)
	assert.equal(ui.calls.verify.length, 0)
})

test('React 18 SMS-only request keeps its channel binding when capabilities change during the request', async t => {
	const pending = deferred()
	const ui = await mountOtp(t, {
		capabilities: capability(['SMS']),
		request: () => pending.promise
	})
	await ui.change('input[type=tel]', '+79991234567')
	await ui.submit()
	assert.deepEqual(ui.calls.request, [['SMS', '+79991234567']])
	await ui.capabilities(capability(['EMAIL']))
	pending.resolve(ui.challenge())
	await ui.flush()
	assert.match(ui.container.textContent, /Код из SMS/)
	assert.doesNotMatch(ui.container.textContent, /Спам/)
	assert.equal(ui.get('input[type=tel]').value, '+79991234567')
	assert.equal(ui.get('input[type=tel]').disabled, true)
	assert.equal(ui.calls.request.length, 1)
})

test('React 18 unknown verify outcome neither authenticates nor sends another code automatically', async t => {
	const ui = await mountOtp(t, {
		verify: async () => {
			throw new Error('private-provider-diagnostic')
		}
	})
	await ui.change('input[type=email]', 'user@example.test')
	await ui.submit()
	await ui.change('input[autocomplete="one-time-code"]', '123456')
	await ui.submit()
	assert.equal(ui.calls.authenticated, 0)
	assert.equal(ui.calls.request.length, 1)
	assert.equal(ui.calls.verify.length, 1)
	assert.equal(ui.get('input[autocomplete="one-time-code"]').value, '')
	assert.doesNotMatch(
		ui.container.textContent,
		/private-provider-diagnostic/
	)
	assert.match(ui.container.textContent, /Не удалось завершить вход/)
	await ui.advance(61000)
	assert.equal(ui.calls.request.length, 1)
	assert.equal(ui.calls.verify.length, 1)
})

test('password login triggers fallback only for the exact server-side CAPTCHA outage, never score rejection', async () => {
	const source = await readFile(
		new URL('model/useAuthForm.ts', base),
		'utf8'
	)
	const ast = ts.createSourceFile(
		'useAuthForm.ts',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	)
	let handler
	const visit = node => {
		if (
			ts.isVariableDeclaration(node) &&
			node.name.getText(ast) === 'handleLoginError'
		)
			handler = node.initializer
		ts.forEachChild(node, visit)
	}
	visit(ast)
	assert.ok(handler)
	const compiled = ts.transpileModule(
		`const handleLoginError = ${handler.getText(ast)}; handleLoginError(error);`,
		{
			fileName: 'handler.ts',
			compilerOptions: { target: ts.ScriptTarget.ES2022 }
		}
	).outputText
	const run = new Function(
		'error',
		'axios',
		'markRecaptchaUnavailable',
		'setAuthMessage',
		'toast',
		compiled
	)
	for (const [status, code, expected] of [
		[503, 'recaptcha_unavailable', 1],
		[403, 'recaptcha_unavailable', 0],
		[403, 'recaptcha_verification_failed', 0],
		[503, 'identity_unavailable', 0],
		[401, 'invalid_credentials', 0],
		[429, 'too_many_requests', 0]
	]) {
		let fallback = 0
		run(
			{
				response: {
					status,
					data: { code, message: 'synthetic safe message' }
				}
			},
			{ isAxiosError: () => true },
			() => fallback++,
			() => {},
			{ error: () => {} }
		)
		assert.equal(fallback, expected, `${status}/${code}`)
	}
	const form = await readFile(
		new URL('ui/auth-form/AuthForm.tsx', base),
		'utf8'
	)
	assert.match(form, /if \(isLogin && isRecaptchaUnavailable\)/)
})
