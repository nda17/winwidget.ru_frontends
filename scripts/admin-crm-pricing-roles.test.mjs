import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
// Test-only workspace dependency; the real editor runs on the admin's React 18.
const { JSDOM } = createRequire(
	new URL('../apps/crm/package.json', import.meta.url)
)('jsdom')
const read = path =>
	readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = (source, imports = {}) => {
	const compiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			jsx: ts.JsxEmit.ReactJSX
		}
	}).outputText
	const module = { exports: {} }
	new Function('exports', 'module', 'require', compiled)(
		module.exports,
		module,
		name => {
			assert.ok(
				Object.hasOwn(imports, name),
				`Unexpected test import: ${name}`
			)
			return imports[name]
		}
	)
	return module.exports
}
const { UserRole } = compile(
	await read(
		'packages/winwidget-web/src/entities/user/model/auth.types.ts'
	)
)
const contract = compile(
	await read(
		'packages/winwidget-web/src/features/admin-crm/model/crm-pricing.contract.ts'
	)
)
const editorSource = await read(
	'apps/admin-panel/src/screens/admin/ui/crm/CrmPricingSettings.tsx'
)
const policy = {
	schemaVersion: 1,
	productCode: 'WINCRM',
	version: 1,
	currency: 'RUB',
	monthlyPriceMinor: 99000,
	yearlyPriceMinor: 990000,
	additionalSeatMonthlyPriceMinor: 10000,
	additionalSeatYearlyPriceMinor: 100000,
	includedSeats: 2,
	trialSeatLimit: 2,
	trialDays: 5,
	graceDays: 3,
	createdAt: '2026-09-05T00:00:00.000Z'
}

async function mount(t, overrides = {}) {
	const state = {
		rights: [UserRole.ADMIN],
		auth: true,
		isAuthResolved: true,
		isUserLoading: false,
		apiEnabled: true,
		...overrides
	}
	const dom = new JSDOM('<!doctype html><div id="root"></div>', {
		url: 'https://winwidget.test/admin/crm'
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
	const query = require('@tanstack/react-query')
	const client = new query.QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Infinity },
			mutations: { gcTime: Infinity }
		}
	})
	const calls = { read: 0, update: [], toast: [] }
	const toast = value => {
		calls.toast.push(value)
		return 'synthetic-toast'
	}
	toast.error = toast
	toast.success = toast
	toast.loading = toast
	const service = {
		getPricingSettings: async () => {
			calls.read++
			return policy
		},
		updatePricingSettings: async command => {
			calls.update.push(command)
			if (state.rejectStatus)
				throw {
					isAxiosError: true,
					response: { status: state.rejectStatus }
				}
			return {
				...policy,
				...Object.fromEntries(
					[...contract.CRM_PRICE_FIELDS, ...contract.CRM_SEAT_FIELDS].map(
						key => [key, command[key]]
					)
				),
				version: 2
			}
		}
	}
	const imports = {
		'@/entities/user': {
			UserRole,
			useAuthStore: selector => selector(state),
			useUser: () => ({
				user: { id: 'synthetic-admin', rights: state.rights },
				isLoading: state.isUserLoading
			})
		},
		'@/features/admin-crm': { ...contract, adminCrmService: service },
		'@/screens/admin/ui/common/admin-tooltip/AdminTooltip': {
			default: ({ title, description }) =>
				React.createElement('span', { title: description }, title)
		},
		'@/shared/ui/skeleton-loader/SkeletonLoader': {
			default: () => React.createElement('p', null, 'Loading')
		},
		'@/shared/config/crm-release.config': { CRM_RELEASE: state },
		'@tanstack/react-query': query,
		axios: {
			default: { isAxiosError: value => value?.isAxiosError === true }
		},
		react: React,
		'react-hot-toast': { default: toast },
		'react/jsx-runtime': require('react/jsx-runtime'),
		'./AdminCrm.module.scss': { default: {} }
	}
	const Component = compile(editorSource, imports).default
	const container = dom.window.document.getElementById('root')
	const root = createRoot(container)
	const render = async () => {
		await act(async () =>
			root.render(
				React.createElement(
					query.QueryClientProvider,
					{ client },
					React.createElement(Component)
				)
			)
		)
	}
	const flush = async () => {
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 5))
		})
	}
	t.after(async () => {
		await act(async () => root.unmount())
		client.clear()
		dom.window.close()
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else Reflect.deleteProperty(globalThis, key)
		}
	})
	await render()
	await flush()
	return {
		state,
		calls,
		container,
		render,
		flush,
		change: async value => {
			const input = container.querySelector('input')
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
		submit: async () => {
			const form = container.querySelector('form')
			assert.ok(form)
			await act(async () =>
				form.dispatchEvent(
					new dom.window.Event('submit', {
						bubbles: true,
						cancelable: true
					})
				)
			)
			await flush()
		}
	}
}

for (const role of [UserRole.ADMIN, UserRole.DEV]) {
	test(`${role} can edit and submit the real versioned CRM pricing form`, async t => {
		const ui = await mount(t, { rights: [role] })
		assert.equal(ui.calls.read, 1)
		assert.equal(ui.container.querySelector('fieldset').disabled, false)
		assert.equal(
			ui.container.querySelector('button[type="submit"]').disabled,
			true
		)
		await ui.change('1200,01')
		assert.equal(
			ui.container.querySelector('button[type="submit"]').disabled,
			false
		)
		await ui.submit()
		assert.equal(ui.calls.update.length, 1)
		assert.equal(ui.calls.update[0].monthlyPriceMinor, 120001)
		assert.equal(ui.calls.update[0].expectedVersion, 1)
		assert.equal(ui.calls.update[0].includedSeats, 2)
		assert.match(ui.calls.update[0].commandId, /^[a-f0-9-]{36}$/)
		assert.ok(
			ui.calls.toast.includes('Новая версия тарифа WinCRM сохранена')
		)
		assert.match(ui.container.textContent, /ADMIN и DEV/)
		assert.match(
			ui.container.querySelector('[title]').title,
			/Журнале событий/
		)
	})
}

for (const [name, state] of [
	['no privileged role', { rights: [UserRole.USER] }],
	['anonymous', { auth: false }],
	['unresolved auth', { isAuthResolved: false }],
	['unresolved profile', { isUserLoading: true }],
	['unreleased backend', { apiEnabled: false }]
]) {
	test(`CRM pricing refuses reads and editing for ${name}`, async t => {
		const ui = await mount(t, state)
		assert.equal(ui.calls.read, 0)
		assert.equal(ui.calls.update.length, 0)
		assert.equal(ui.container.querySelector('form'), null)
	})
}

test('revoking ADMIN access removes the editor and cannot reuse cached prices to save', async t => {
	const ui = await mount(t)
	await ui.change('1200')
	ui.state.rights = [UserRole.USER]
	await ui.render()
	assert.equal(ui.container.querySelector('form'), null)
	assert.equal(ui.calls.update.length, 0)
})

for (const status of [401, 403]) {
	test(`server ${status} still locks ADMIN editing without an automatic retry`, async t => {
		const ui = await mount(t, { rejectStatus: status })
		await ui.change('1200')
		await ui.submit()
		assert.equal(ui.calls.update.length, 1)
		assert.equal(ui.container.querySelector('fieldset').disabled, true)
		assert.equal(
			ui.container.querySelector('button[type="submit"]').disabled,
			true
		)
		assert.match(
			ui.container.textContent,
			/Сервер не подтвердил право на изменение/
		)
		assert.ok(
			ui.calls.toast.includes(
				'Сохранение недоступно. Требуется действующий доступ ADMIN или DEV'
			)
		)
		await ui.submit()
		assert.equal(ui.calls.update.length, 1)
	})
}
