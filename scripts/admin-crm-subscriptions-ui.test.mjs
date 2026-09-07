import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
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
			assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`)
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
		'packages/winwidget-web/src/features/admin-crm/model/crm-subscriptions.contract.ts'
	)
)
const pendingSource = await read(
	'packages/winwidget-web/src/features/admin-crm/model/crm-subscription-pending.ts'
)
const componentSource = await read(
	'apps/admin-panel/src/screens/admin/ui/crm/CrmSubscriptionAdmin.tsx'
)
const workspace = '11111111-1111-4111-8111-111111111111'
const previousCommand = '33333333-3333-4333-8333-333333333333'
const subscription = ownerSubject => ({
	workspaceId: workspace,
	ownerSubject,
	entitlementVersion: '1',
	billingVersion: '0',
	entitlement: {
		planCode: 'TRIAL',
		status: 'ACTIVE',
		seatLimit: 2,
		effectiveFrom: '2026-09-01T00:00:00.000Z',
		effectiveUntil: '2026-09-06T00:00:00.000Z',
		graceUntil: '2026-09-09T00:00:00.000Z'
	},
	period: null,
	renewal: null,
	extensionTarget: 'ENTITLEMENT',
	blockedReason: null
})

async function mount(t, overrides = {}) {
	const state = {
		rights: [UserRole.ADMIN],
		auth: true,
		isAuthResolved: true,
		isUserLoading: false,
		apiEnabled: true,
		actorSubject: 'admin-owner',
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
	if (state.marker)
		dom.window.sessionStorage.setItem(
			`wincrm-admin-grant-v1:${state.actorSubject}`,
			JSON.stringify(state.marker)
		)
	if (state.storageBlocked)
		Object.defineProperty(dom.window, 'sessionStorage', {
			get: () => {
				throw new Error('Storage blocked')
			}
		})
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
	const calls = {
		list: [],
		detail: [],
		history: [],
		search: [],
		extend: [],
		command: [],
		cancel: [],
		toast: []
	}
	const listeners = new Set()
	const useAuthStore = selector => selector(state)
	useAuthStore.getState = () => state
	useAuthStore.subscribe = listener => {
		listeners.add(listener)
		return () => listeners.delete(listener)
	}
	const pending = compile(pendingSource, {
		'./crm-subscriptions.contract': contract,
		'@/entities/user/model/auth-store': { useAuthStore }
	})
	const toast = value => {
		calls.toast.push(value)
		return 'test-toast'
	}
	toast.error = toast
	toast.success = toast
	toast.loading = toast
	toast.dismiss = () => {}
	let lastCommand = null
	const makeResult = command => ({
		schemaVersion: 1,
		workspaceId: workspace,
		commandId: command.commandId,
		grant: {
			commandId: command.commandId,
			workspaceId: workspace,
			actorSubject: state.actorSubject,
			actorRole: state.rights.includes(UserRole.DEV) ? 'DEV' : 'ADMIN',
			days: command.days,
			reason: command.reason,
			target: 'ENTITLEMENT',
			periodId: null,
			oldExpiresAt: '2026-09-06T00:00:00.000Z',
			newExpiresAt: '2026-09-13T00:00:00.000Z',
			createdAt: '2026-09-06T00:00:00.000Z'
		},
		subscription: {
			...subscription(state.actorSubject),
			entitlementVersion: '2'
		}
	})
	const service = {
		list: async (page, pageSize, ownerSubject) => {
			calls.list.push({ page, pageSize, ownerSubject })
			return {
				schemaVersion: 1,
				page,
				pageSize,
				total: state.total ?? 1,
				items: [subscription(ownerSubject ?? state.actorSubject)]
			}
		},
		detail: async id => {
			calls.detail.push(id)
			return subscription(state.actorSubject)
		},
		history: async (id, page, pageSize) => {
			calls.history.push({ id, page, pageSize })
			return {
				schemaVersion: 1,
				page,
				pageSize,
				total: state.historyTotal ?? 0,
				items: []
			}
		},
		extendDays: async (id, actor, command) => {
			if (state.preflightReject)
				throw new contract.CrmAdminGrantNotSentError()
			calls.extend.push({ id, actor, command })
			lastCommand = command
			if (state.rejectStatus)
				throw {
					isAxiosError: true,
					response: {
						status: state.rejectStatus,
						data: { code: state.rejectCode }
					}
				}
			return makeResult(command)
		},
		command: async (id, commandId, actor) => {
			calls.command.push({ id, commandId, actor })
			if (state.lookupCancelled)
				return {
					schemaVersion: 1,
					workspaceId: id,
					commandId,
					actorSubject: actor,
					actorRole: 'ADMIN',
					outcome: 'CANCELLED',
					cancelledAt: '2026-09-07T12:00:00.000Z'
				}
			if (state.lookupStatus || !lastCommand)
				throw {
					isAxiosError: true,
					response: { status: state.lookupStatus ?? 404 }
				}
			return {
				schemaVersion: 1,
				workspaceId: id,
				commandId,
				actorSubject: actor,
				outcome: 'COMMITTED',
				result: makeResult(lastCommand)
			}
		},
		cancelCommand: async (id, commandId, actor) => {
			calls.cancel.push({ id, commandId, actor })
			if (state.cancelStatus)
				throw {
					isAxiosError: true,
					response: { status: state.cancelStatus }
				}
			if (state.cancelCommitted)
				return {
					schemaVersion: 1,
					workspaceId: id,
					commandId,
					actorSubject: actor,
					outcome: 'COMMITTED',
					result: makeResult({
						commandId,
						days: 7,
						reason: 'Причина',
						expectedActorSubject: actor
					})
				}
			return {
				schemaVersion: 1,
				workspaceId: id,
				commandId,
				actorSubject: actor,
				actorRole: 'ADMIN',
				outcome: 'CANCELLED',
				cancelledAt: '2026-09-07T12:00:00.000Z'
			}
		}
	}
	const imports = {
		'@/entities/user': {
			UserRole,
			useAuthStore,
			useUser: () => ({
				user: {
					id: state.actorSubject,
					name: 'Администратор',
					rights: state.rights
				},
				isLoading: state.isUserLoading
			}),
			userService: {
				fetchUserList: async (search, page, pageSize) => {
					calls.search.push({ search, page, pageSize })
					return {
						data: {
							items: [
								{
									id: 'client-owner',
									name: 'Клиент',
									email: 'client@example.test'
								}
							],
							total: 1,
							page,
							limit: pageSize
						}
					}
				}
			}
		},
		'@/features/admin-crm': {
			...contract,
			...pending,
			adminCrmSubscriptionsService: service
		},
		'@/shared/config/crm-release.config': { CRM_RELEASE: state },
		'@/shared/ui/confirm-dialog/ConfirmDialog': {
			default: ({
				title,
				message,
				onConfirm,
				onCancel,
				confirmDisabled,
				confirmLabel,
				children
			}) =>
				React.createElement(
					'div',
					{ role: 'dialog' },
					React.createElement('h3', null, title),
					React.createElement('p', null, message),
					children,
					React.createElement(
						'button',
						{ onClick: onConfirm, disabled: confirmDisabled },
						confirmLabel
					),
					React.createElement('button', { onClick: onCancel }, 'Отмена')
				)
		},
		'@/screens/admin/ui/common/admin-tooltip/AdminTooltip': {
			default: ({ title, description }) =>
				React.createElement('span', { title: description }, title)
		},
		'@tanstack/react-query': query,
		axios: {
			default: { isAxiosError: value => value?.isAxiosError === true }
		},
		react: React,
		'react-hot-toast': { default: toast },
		'react/jsx-runtime': require('react/jsx-runtime'),
		'./AdminCrm.module.scss': { default: {} },
		'./CrmSubscriptionAdmin.module.scss': { default: {} }
	}
	const Component = compile(componentSource, imports).default
	const container = dom.window.document.getElementById('root')
	const root = createRoot(container)
	const flush = async () => {
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 10))
		})
	}
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
		await flush()
	}
	const click = async (text, scope = container) => {
		const button = [...scope.querySelectorAll('button')].find(button =>
			button.textContent.includes(text)
		)
		assert.ok(button, `Missing button ${text}`)
		await act(async () => button.click())
		await flush()
	}
	const fill = async (label, value) => {
		const wrapper = [...container.querySelectorAll('label')].find(item =>
			item.textContent.includes(label)
		)
		const input = wrapper?.querySelector('input, textarea')
		assert.ok(input, `Missing field ${label}`)
		await act(async () => {
			const prototype =
				input.tagName === 'TEXTAREA'
					? dom.window.HTMLTextAreaElement.prototype
					: dom.window.HTMLInputElement.prototype
			Object.getOwnPropertyDescriptor(prototype, 'value').set.call(
				input,
				value
			)
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
		})
	}
	const submitGrant = async () => {
		const form = container.querySelector('fieldset')?.closest('form')
		assert.ok(form)
		await act(async () =>
			form.dispatchEvent(
				new dom.window.Event('submit', { bubbles: true, cancelable: true })
			)
		)
		await flush()
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
	return {
		state,
		calls,
		container,
		click,
		fill,
		submitGrant,
		render,
		flush,
		pending,
		dom,
		transition: async next => {
			const prior = { ...state }
			Object.assign(state, next)
			listeners.forEach(listener => listener(state, prior))
			await render()
		}
	}
}

for (const role of [UserRole.ADMIN, UserRole.DEV])
	test(`${role} can grant CRM days to self with confirmation and unchanged Widgets`, async t => {
		const ui = await mount(t, { rights: [role] })
		await ui.click('Моя CRM')
		assert.equal(ui.calls.list.at(-1).ownerSubject, 'admin-owner')
		await ui.click('Пробный доступ')
		await ui.fill('Количество дней', '14')
		await ui.fill('Причина начисления', 'Компенсация перерыва')
		await ui.submitGrant()
		assert.equal(ui.calls.extend.length, 0)
		assert.match(
			ui.container.querySelector('[role="dialog"]').textContent,
			/Денежного списания не будет/
		)
		await ui.click('Подтвердить начисление')
		assert.equal(ui.calls.extend.length, 1)
		assert.equal(ui.calls.extend[0].id, workspace)
		assert.equal(ui.calls.extend[0].actor, 'admin-owner')
		assert.equal(ui.calls.extend[0].command.days, 14)
		assert.equal(
			ui.calls.extend[0].command.expectedEntitlementVersion,
			'1'
		)
		assert.equal(ui.calls.extend[0].command.expectedBillingVersion, '0')
		assert.equal(
			ui.calls.extend[0].command.expectedActorSubject,
			'admin-owner'
		)
		assert.ok(
			ui.calls.toast.some(message =>
				message.startsWith('Начислено 14 дней')
			)
		)
		assert.equal(ui.pending.readPendingCrmAdminGrant('admin-owner'), null)
	})

for (const [name, state] of [
	['USER', { rights: [UserRole.USER] }],
	['CRM_ADMIN domain role', { rights: ['CRM_ADMIN'] }],
	['anonymous', { auth: false }],
	['unresolved auth', { isAuthResolved: false }],
	['unresolved profile', { isUserLoading: true }],
	['API disabled', { apiEnabled: false }]
])
	test(`does not read or mutate CRM subscriptions for ${name}`, async t => {
		const ui = await mount(t, state)
		assert.equal(ui.calls.list.length, 0)
		assert.equal(ui.calls.extend.length, 0)
		assert.equal(ui.container.querySelector('form'), null)
	})

test('server-backed owner search can target a client independently of own CRM', async t => {
	const ui = await mount(t)
	await ui.fill('Найти владельца по имени', 'client@example.test')
	await ui.click('Найти владельца')
	assert.deepEqual(ui.calls.search, [
		{ search: 'client@example.test', page: 1, pageSize: 10 }
	])
	await ui.click('Клиент')
	assert.equal(ui.calls.list.at(-1).ownerSubject, 'client-owner')
	assert.match(ui.container.textContent, /Владелец: Клиент/)
})

test('unknown result retries exactly one immutable command, not a new grant', async t => {
	const ui = await mount(t, { rejectStatus: 503 })
	await ui.click('Пробный доступ')
	await ui.fill('Причина начисления', 'Компенсация перерыва')
	await ui.submitGrant()
	await ui.click('Подтвердить начисление')
	assert.equal(ui.calls.extend.length, 1)
	assert.equal(ui.container.querySelector('fieldset').disabled, true)
	assert.match(
		ui.container.textContent,
		/Результат предыдущего начисления пока не подтверждён/
	)
	ui.state.rejectStatus = null
	await ui.click('Повторить ту же попытку')
	assert.equal(ui.calls.extend.length, 2)
	assert.equal(ui.calls.extend[0].command, ui.calls.extend[1].command)
	assert.equal(ui.pending.readPendingCrmAdminGrant('admin-owner'), null)
})

test('reload recovery with empty history and lookup 404 cannot unlock a second grant', async t => {
	const ui = await mount(t, {
		marker: {
			schemaVersion: 1,
			workspaceId: workspace,
			commandId: previousCommand
		},
		lookupStatus: 404
	})
	assert.equal(ui.container.querySelector('fieldset').disabled, true)
	assert.ok(!ui.container.textContent.includes('Повторить ту же попытку'))
	await ui.click('Проверить результат')
	assert.deepEqual(ui.calls.command, [
		{ id: workspace, commandId: previousCommand, actor: 'admin-owner' }
	])
	assert.equal(ui.container.querySelector('fieldset').disabled, true)
	assert.equal(ui.calls.extend.length, 0)
	assert.ok(ui.pending.readPendingCrmAdminGrant('admin-owner'))
})

test('logout and new login keep unresolved request readonly even for the same administrator', async t => {
	const ui = await mount(t, { rejectStatus: 503 })
	await ui.click('Пробный доступ')
	await ui.fill('Причина начисления', 'Причина')
	await ui.submitGrant()
	await ui.click('Подтвердить начисление')
	await ui.transition({ auth: false })
	await ui.transition({ auth: true })
	assert.equal(ui.calls.extend.length, 1)
	assert.ok(!ui.container.textContent.includes('Повторить ту же попытку'))
	assert.equal(ui.container.querySelector('fieldset').disabled, true)
})

test('blocked storage leaves readonly subscription details accessible but sends no grant', async t => {
	const ui = await mount(t, { storageBlocked: true })
	await ui.click('Пробный доступ')
	assert.equal(ui.container.querySelector('fieldset').disabled, true)
	assert.match(ui.container.textContent, /Новые начисления заблокированы/)
	assert.equal(ui.calls.extend.length, 0)
})

test('list and history pagination request the corresponding server page', async t => {
	const ui = await mount(t, { total: 21, historyTotal: 21 })
	await ui.click(
		'Далее',
		ui.container.querySelector('[aria-label="Страницы подписок CRM"]')
	)
	assert.equal(ui.calls.list.at(-1).page, 2)
	await ui.click('Пробный доступ')
	await ui.click(
		'Далее',
		ui.container.querySelector('[aria-label="Страницы истории CRM"]')
	)
	assert.equal(ui.calls.history.at(-1).page, 2)
})

test('first-request authoritative CAS rejection requires fresh review and never retries automatically', async t => {
	const ui = await mount(t, {
		rejectStatus: 409,
		rejectCode: 'crm_admin_subscription_version_conflict'
	})
	await ui.click('Пробный доступ')
	await ui.fill('Причина начисления', 'Причина')
	await ui.submitGrant()
	await ui.click('Подтвердить начисление')
	assert.equal(ui.calls.extend.length, 1)
	assert.equal(ui.pending.readPendingCrmAdminGrant('admin-owner'), null)
	assert.ok(ui.calls.detail.length > 1)
	assert.ok(
		ui.calls.toast.some(message =>
			message.startsWith('Начисление отклонено')
		)
	)
})

test('actor binding failure before first dispatch releases only the never-sent marker', async t => {
	const ui = await mount(t, { preflightReject: true })
	await ui.click('Пробный доступ')
	await ui.fill('Причина начисления', 'Причина')
	await ui.submitGrant()
	await ui.click('Подтвердить начисление')
	assert.equal(ui.calls.extend.length, 0)
	assert.equal(ui.pending.readPendingCrmAdminGrant('admin-owner'), null)
	assert.equal(ui.container.querySelector('fieldset').disabled, true)
	assert.ok(
		ui.calls.toast.some(message =>
			message.includes('Начисление не отправлено')
		)
	)
})

test('actor binding failure before replay cannot discard an earlier unknown grant', async t => {
	const ui = await mount(t, { rejectStatus: 503 })
	await ui.click('Пробный доступ')
	await ui.fill('Причина начисления', 'Причина')
	await ui.submitGrant()
	await ui.click('Подтвердить начисление')
	const previous = ui.pending.readPendingCrmAdminGrant('admin-owner')
	ui.state.preflightReject = true
	await ui.click('Повторить ту же попытку')
	assert.equal(ui.calls.extend.length, 1)
	assert.equal(
		ui.pending.readPendingCrmAdminGrant('admin-owner').commandId,
		previous.commandId
	)
	assert.equal(ui.container.querySelector('fieldset').disabled, true)
})

test('marker-only cancellation needs explicit confirmation and unlocks only on terminal CANCELLED', async t => {
	const ui = await mount(t, {
		marker: {
			schemaVersion: 1,
			workspaceId: workspace,
			commandId: previousCommand
		}
	})
	await ui.click('Отменить неподтверждённую команду')
	assert.equal(ui.calls.cancel.length, 0)
	assert.match(
		ui.container.querySelector('[role="dialog"]').textContent,
		/Подтверждённые начисления не отменяются/
	)
	await ui.click('Отменить команду')
	assert.deepEqual(ui.calls.cancel, [
		{ id: workspace, commandId: previousCommand, actor: 'admin-owner' }
	])
	assert.equal(ui.pending.readPendingCrmAdminGrant('admin-owner'), null)
	assert.equal(ui.calls.extend.length, 0)
	assert.ok(
		ui.calls.toast.some(message => message.startsWith('Команда отменена'))
	)
})

test('cancel racing a committed grant displays the original result without compensating or re-granting', async t => {
	const ui = await mount(t, {
		marker: {
			schemaVersion: 1,
			workspaceId: workspace,
			commandId: previousCommand
		},
		cancelCommitted: true
	})
	await ui.click('Отменить неподтверждённую команду')
	await ui.click('Отменить команду')
	assert.equal(ui.calls.extend.length, 0)
	assert.equal(ui.pending.readPendingCrmAdminGrant('admin-owner'), null)
	assert.ok(ui.calls.toast.includes('Начисление подтверждено: 7 дней'))
	assert.ok(
		!ui.calls.toast.some(message => message.startsWith('Команда отменена'))
	)
})

for (const status of [401, 404, 409, 503])
	test(`cancel ${status} cannot discard the unknown marker`, async t => {
		const ui = await mount(t, {
			marker: {
				schemaVersion: 1,
				workspaceId: workspace,
				commandId: previousCommand
			},
			cancelStatus: status
		})
		await ui.click('Отменить неподтверждённую команду')
		await ui.click('Отменить команду')
		assert.equal(ui.calls.cancel.length, 1)
		assert.equal(ui.calls.extend.length, 0)
		assert.equal(
			ui.pending.readPendingCrmAdminGrant('admin-owner').commandId,
			previousCommand
		)
		assert.equal(ui.container.querySelector('fieldset').disabled, true)
	})

test('GET terminal CANCELLED proof recovers a lost cancellation response after reload', async t => {
	const ui = await mount(t, {
		marker: {
			schemaVersion: 1,
			workspaceId: workspace,
			commandId: previousCommand
		},
		lookupCancelled: true
	})
	await ui.click('Проверить результат')
	assert.equal(ui.pending.readPendingCrmAdminGrant('admin-owner'), null)
	assert.equal(ui.calls.cancel.length, 0)
	assert.equal(ui.calls.extend.length, 0)
})

test('an in-memory unknown command keeps exact retry instead of offering marker cancellation', async t => {
	const ui = await mount(t, { rejectStatus: 503 })
	await ui.click('Пробный доступ')
	await ui.fill('Причина начисления', 'Причина')
	await ui.submitGrant()
	await ui.click('Подтвердить начисление')
	assert.ok(ui.container.textContent.includes('Повторить ту же попытку'))
	assert.ok(
		!ui.container.textContent.includes('Отменить неподтверждённую команду')
	)
})
