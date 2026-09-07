import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import axios from 'axios'
import { decodeJwt } from 'jose'

const read = path =>
	readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = (source, imports = {}) => {
	const compiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022
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
const root = 'packages/winwidget-web/src/features/admin-crm/'
const contract = compile(
	await read(`${root}model/crm-subscriptions.contract.ts`)
)
const pendingSource = await read(
	`${root}model/crm-subscription-pending.ts`
)
const apiSource = await read(`${root}api/admin-crm-subscriptions.api.ts`)
const workspace = '11111111-1111-4111-8111-111111111111'
const otherWorkspace = '22222222-2222-4222-8222-222222222222'
const commandId = '33333333-3333-4333-8333-333333333333'
const otherCommand = '44444444-4444-4444-8444-444444444444'
const subscription = () => ({
	workspaceId: workspace,
	ownerSubject: 'admin-owner',
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
const command = () =>
	contract.createCrmAdminGrantCommand(
		subscription(),
		'7',
		'Компенсация перерыва',
		commandId,
		'admin-owner'
	)
const grant = () => ({
	commandId,
	workspaceId: workspace,
	actorSubject: 'admin-owner',
	actorRole: 'ADMIN',
	days: 7,
	reason: 'Компенсация перерыва',
	target: 'ENTITLEMENT',
	periodId: null,
	oldExpiresAt: '2026-09-06T00:00:00.000Z',
	newExpiresAt: '2026-09-13T00:00:00.000Z',
	createdAt: '2026-09-06T00:00:00.000Z'
})
const result = () => ({
	schemaVersion: 1,
	workspaceId: workspace,
	commandId,
	grant: grant(),
	subscription: {
		...subscription(),
		entitlementVersion: '2',
		entitlement: {
			...subscription().entitlement,
			effectiveUntil: grant().newExpiresAt
		}
	}
})

test('parses current CRM admin subscription without changing Widgets contracts', () => {
	assert.deepEqual(
		contract.parseCrmAdminSubscription(subscription()),
		subscription()
	)
	assert.deepEqual(
		contract.parseCrmAdminSubscriptionDetail(
			{ schemaVersion: 1, subscription: subscription() },
			workspace
		),
		subscription()
	)
	assert.throws(() =>
		contract.parseCrmAdminSubscriptionDetail(
			{ schemaVersion: 1, subscription: subscription() },
			otherWorkspace
		)
	)
})

test('creates positive-day command with exact CAS snapshot and trimmed audit reason', () => {
	assert.deepEqual(
		contract.createCrmAdminGrantCommand(
			subscription(),
			'7',
			'  Компенсация перерыва  ',
			commandId,
			'admin-owner'
		),
		{
			schemaVersion: 1,
			commandId,
			expectedActorSubject: 'admin-owner',
			expectedEntitlementVersion: '1',
			expectedBillingVersion: '0',
			expectedPeriodId: null,
			expectedPeriodVersion: null,
			days: 7,
			reason: 'Компенсация перерыва'
		}
	)
	for (const days of ['0', '-1', '3651', '1.5', '1e3', '', 'NaN'])
		assert.throws(() =>
			contract.createCrmAdminGrantCommand(
				subscription(),
				days,
				'Причина',
				commandId,
				'admin-owner'
			)
		)
	for (const reason of ['', '  a ', 'x'.repeat(1001)])
		assert.throws(() =>
			contract.createCrmAdminGrantCommand(
				subscription(),
				'1',
				reason,
				commandId,
				'admin-owner'
			)
		)
	assert.throws(() =>
		contract.createCrmAdminGrantCommand(
			{
				...subscription(),
				blockedReason: 'crm_admin_subscription_suspended'
			},
			'1',
			'Причина',
			commandId,
			'admin-owner'
		)
	)
})

test('keeps paid period CAS independent of entitlement and supports large bigint versions', () => {
	const paid = {
		...subscription(),
		entitlementVersion: '9007199254740993',
		billingVersion: '9007199254740994',
		extensionTarget: 'PAID_PERIOD',
		period: {
			id: otherWorkspace,
			version: 3,
			startsAt: '2026-09-06T00:00:00.000Z',
			expiresAt: '2026-10-06T00:00:00.000Z',
			graceUntil: '2026-10-09T00:00:00.000Z',
			totalSeats: 2
		}
	}
	const value = contract.createCrmAdminGrantCommand(
		paid,
		'1',
		'Причина',
		commandId,
		'admin-owner'
	)
	assert.equal(value.expectedEntitlementVersion, '9007199254740993')
	assert.equal(value.expectedBillingVersion, '9007199254740994')
	assert.equal(value.expectedPeriodId, otherWorkspace)
	assert.equal(value.expectedPeriodVersion, 3)
	assert.throws(() =>
		contract.parseCrmAdminSubscription({
			...paid,
			entitlementVersion: '9223372036854775808'
		})
	)
})

for (const change of [
	value => {
		value.extra = true
	},
	value => {
		value.entitlementVersion = 1
	},
	value => {
		value.entitlement.effectiveUntil = '2026-02-31T00:00:00.000Z'
	},
	value => {
		value.entitlement.seatLimit = 1
	},
	value => {
		value.extensionTarget = 'PAID_PERIOD'
	}
])
	test(`rejects invalid subscription ${change.toString()}`, () => {
		const value = subscription()
		change(value)
		assert.throws(() => contract.parseCrmAdminSubscription(value))
	})

test('accepts only exact command, workspace, actor and reason receipt binding', () => {
	assert.deepEqual(
		contract.parseCrmAdminGrantResult(
			result(),
			workspace,
			commandId,
			'admin-owner',
			command()
		),
		result()
	)
	for (const change of [
		value => {
			value.commandId = otherCommand
		},
		value => {
			value.grant.actorSubject = 'other-admin'
		},
		value => {
			value.grant.workspaceId = otherWorkspace
		},
		value => {
			value.subscription.workspaceId = otherWorkspace
		},
		value => {
			value.grant.days = 8
		},
		value => {
			value.grant.reason = 'Другая причина'
		},
		value => {
			value.grant.newExpiresAt = value.grant.oldExpiresAt
		}
	]) {
		const value = result()
		change(value)
		assert.throws(() =>
			contract.parseCrmAdminGrantResult(
				value,
				workspace,
				commandId,
				'admin-owner',
				command()
			)
		)
	}
})

test('requires server pagination and workspace-bound history entries', () => {
	const history = {
		schemaVersion: 1,
		workspaceId: workspace,
		page: 2,
		pageSize: 10,
		total: 11,
		items: [grant()]
	}
	assert.equal(
		contract.parseCrmAdminHistory(history, workspace, 2, 10).total,
		11
	)
	assert.throws(() =>
		contract.parseCrmAdminHistory(history, otherWorkspace, 2, 10)
	)
	assert.throws(() =>
		contract.parseCrmAdminHistory(history, workspace, 1, 10)
	)
	assert.throws(() =>
		contract.parseCrmAdminHistory(
			{ ...history, items: [{ ...grant(), workspaceId: otherWorkspace }] },
			workspace,
			2,
			10
		)
	)
})

function pendingHarness() {
	let state = { auth: true, isAuthResolved: true }
	const listeners = new Set()
	const authStore = {
		getState: () => state,
		subscribe: listener => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		}
	}
	const storage = new Map()
	const window = {
		sessionStorage: {
			getItem: key => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, value),
			removeItem: key => storage.delete(key)
		}
	}
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
	Object.defineProperty(globalThis, 'window', {
		value: window,
		configurable: true
	})
	const pending = compile(pendingSource, {
		'./crm-subscriptions.contract': contract,
		'@/entities/user/model/auth-store': { useAuthStore: authStore }
	})
	pending.bindCrmAdminGrantActor('admin-owner')
	return {
		pending,
		storage,
		window,
		transition: next => {
			const prior = state
			state = { ...state, ...next }
			listeners.forEach(listener => listener(state, prior))
		},
		close: () => {
			if (previous) Object.defineProperty(globalThis, 'window', previous)
			else Reflect.deleteProperty(globalThis, 'window')
		}
	}
}

test('persists only recovery IDs and requires the exact same in-memory command for retry', t => {
	const h = pendingHarness()
	t.after(h.close)
	const saved = h.pending.retainPendingCrmAdminGrant(
		'admin-owner',
		workspace,
		command()
	)
	assert.equal(h.pending.readPendingCrmAdminGrant('admin-owner'), saved)
	assert.equal(
		h.pending.retainPendingCrmAdminGrant(
			'admin-owner',
			workspace,
			saved.command
		),
		saved
	)
	assert.throws(() =>
		h.pending.retainPendingCrmAdminGrant('admin-owner', workspace, {
			...saved.command
		})
	)
	assert.throws(() =>
		h.pending.retainPendingCrmAdminGrant('admin-owner', workspace, {
			...command(),
			commandId: otherCommand
		})
	)
	assert.deepEqual(JSON.parse([...h.storage.values()][0]), {
		schemaVersion: 1,
		workspaceId: workspace,
		commandId
	})
	h.pending.clearResolvedCrmAdminGrant('admin-owner', commandId)
	assert.equal(h.pending.readPendingCrmAdminGrant('admin-owner'), null)
	assert.doesNotThrow(() =>
		h.pending.clearResolvedCrmAdminGrant('admin-owner', commandId)
	)
})

test('logout and login as the same actor retain only readonly recovery, never the stale POST', t => {
	const h = pendingHarness()
	t.after(h.close)
	const saved = h.pending.retainPendingCrmAdminGrant(
		'admin-owner',
		workspace,
		command()
	)
	h.transition({ auth: false })
	h.transition({ auth: true })
	h.pending.bindCrmAdminGrantActor('admin-owner')
	assert.equal(
		h.pending.readPendingCrmAdminGrant('admin-owner').command,
		undefined
	)
	assert.throws(() =>
		h.pending.retainPendingCrmAdminGrant(
			'admin-owner',
			workspace,
			saved.command
		)
	)
	assert.throws(() =>
		h.pending.clearResolvedCrmAdminGrant('admin-owner', otherCommand)
	)
})

test('changing actor discards command payload and cannot take another actor marker', t => {
	const h = pendingHarness()
	t.after(h.close)
	const saved = h.pending.retainPendingCrmAdminGrant(
		'admin-owner',
		workspace,
		command()
	)
	h.pending.bindCrmAdminGrantActor('another-admin')
	assert.equal(h.pending.readPendingCrmAdminGrant('another-admin'), null)
	h.pending.bindCrmAdminGrantActor('admin-owner')
	assert.equal(
		h.pending.readPendingCrmAdminGrant('admin-owner').command,
		undefined
	)
	assert.throws(() =>
		h.pending.retainPendingCrmAdminGrant(
			'admin-owner',
			workspace,
			saved.command
		)
	)
})

test('blocked or malformed session storage fails closed before retaining a new POST', t => {
	const h = pendingHarness()
	t.after(h.close)
	h.storage.set('wincrm-admin-grant-v1:admin-owner', '{broken')
	assert.throws(() =>
		h.pending.retainPendingCrmAdminGrant(
			'admin-owner',
			workspace,
			command()
		)
	)
	h.storage.clear()
	h.window.sessionStorage.setItem = () => {
		throw new Error('storage blocked')
	}
	assert.throws(() =>
		h.pending.retainPendingCrmAdminGrant(
			'admin-owner',
			workspace,
			command()
		)
	)
	assert.equal(h.pending.readPendingCrmAdminGrant('admin-owner'), null)
})

test('API posts only CRM grant with the stable idempotency key; foreign-owner list is rejected', async () => {
	const calls = []
	const token = syntheticToken('admin-owner')
	const api = compile(apiSource, {
		'@/shared/api': {
			getAccessToken: () => token,
			isAccessTokenValid: validToken,
			axiosClassicRequest: {
				post: async (...args) => {
					calls.push(args)
					return { data: result() }
				}
			},
			axiosInterceptorsRequest: {
				get: async () => ({
					data: {
						schemaVersion: 1,
						page: 1,
						pageSize: 10,
						total: 1,
						items: [subscription()]
					}
				})
			}
		},
		jose: { decodeJwt },
		'../model/crm-subscriptions.contract': contract
	}).adminCrmSubscriptionsService
	await api.extendDays(workspace, 'admin-owner', command())
	assert.equal(
		calls[0][0],
		`/subscriptions/admin/crm/${workspace}/extend-days`
	)
	assert.equal(calls[0][2].headers['Idempotency-Key'], commandId)
	assert.equal(calls[0][2].headers.Authorization, `Bearer ${token}`)
	assert.deepEqual(calls[0][1], command())
	await assert.rejects(() => api.list(1, 10, 'foreign-owner'))
	assert.equal(calls.length, 1)
})

function syntheticToken(
	subject,
	expiresAt = Math.floor(Date.now() / 1000) + 3600
) {
	return `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: subject, exp: expiresAt })).toString('base64url')}.synthetic-unit-test-signature`
}
function validToken(token) {
	try {
		return !!token && decodeJwt(token).exp * 1000 > Date.now()
	} catch {
		return false
	}
}

const cancelledProof = () => ({
	schemaVersion: 1,
	workspaceId: workspace,
	commandId,
	actorSubject: 'admin-owner',
	actorRole: 'ADMIN',
	outcome: 'CANCELLED',
	cancelledAt: '2026-09-07T12:00:00.000Z'
})

test('terminal recovery requires exact actor/workspace/command proof, not absence or partial history', () => {
	const committed = {
		schemaVersion: 1,
		workspaceId: workspace,
		commandId,
		actorSubject: 'admin-owner',
		outcome: 'COMMITTED',
		result: result()
	}
	assert.deepEqual(
		contract.parseCrmAdminCommandRecovery(
			committed,
			workspace,
			commandId,
			'admin-owner'
		),
		committed
	)
	assert.deepEqual(
		contract.parseCrmAdminCommandRecovery(
			cancelledProof(),
			workspace,
			commandId,
			'admin-owner'
		),
		cancelledProof()
	)
	for (const value of [
		null,
		{},
		{ ...cancelledProof(), actorSubject: 'another-admin' },
		{ ...cancelledProof(), workspaceId: otherWorkspace },
		{ ...cancelledProof(), commandId: otherCommand },
		{ ...cancelledProof(), actorRole: 'USER' },
		{ ...cancelledProof(), outcome: 'UNKNOWN' },
		{ ...cancelledProof(), cancelledAt: 'not-date' },
		{ ...cancelledProof(), extra: true },
		{
			...committed,
			result: {
				...result(),
				grant: { ...grant(), actorSubject: 'another-admin' }
			}
		}
	])
		assert.throws(() =>
			contract.parseCrmAdminCommandRecovery(
				value,
				workspace,
				commandId,
				'admin-owner'
			)
		)
})

test('cancel posts only the original command ID and captured actor, never the reason or grant payload', async () => {
	const calls = []
	const token = syntheticToken('admin-owner')
	const api = compile(apiSource, {
		'@/shared/api': {
			getAccessToken: () => token,
			isAccessTokenValid: validToken,
			axiosClassicRequest: {
				post: async (...args) => {
					calls.push(args)
					return { data: cancelledProof() }
				}
			}
		},
		jose: { decodeJwt },
		'../model/crm-subscriptions.contract': contract
	}).adminCrmSubscriptionsService
	assert.deepEqual(
		await api.cancelCommand(workspace, commandId, 'admin-owner'),
		cancelledProof()
	)
	assert.equal(
		calls[0][0],
		`/subscriptions/admin/crm/${workspace}/commands/${commandId}/cancel`
	)
	assert.deepEqual(calls[0][1], {
		schemaVersion: 1,
		expectedActorSubject: 'admin-owner'
	})
	assert.equal(calls[0][2].headers['Idempotency-Key'], commandId)
	assert.equal(calls[0][2].headers.Authorization, `Bearer ${token}`)
})

test('cancel 401 during actor replacement never uses the shared refresh-and-replay transport', async () => {
	let token = syntheticToken('admin-owner')
	let posts = 0
	const api = compile(apiSource, {
		'@/shared/api': {
			getAccessToken: () => token,
			isAccessTokenValid: validToken,
			axiosInterceptorsRequest: {
				post: () => {
					assert.fail('Cancel must not enter auth-refresh transport')
				}
			},
			axiosClassicRequest: {
				post: async () => {
					posts++
					token = syntheticToken('another-admin')
					throw { response: { status: 401 } }
				}
			}
		},
		jose: { decodeJwt },
		'../model/crm-subscriptions.contract': contract
	}).adminCrmSubscriptionsService
	await assert.rejects(
		() => api.cancelCommand(workspace, commandId, 'admin-owner'),
		error => error.response?.status === 401
	)
	await assert.rejects(
		() => api.cancelCommand(workspace, commandId, 'admin-owner'),
		contract.CrmAdminGrantNotSentError
	)
	assert.equal(posts, 1)
})

test('grant transport never refreshes or replays POST after 401 while another request logs in a different actor', async () => {
	const tokenA = syntheticToken('admin-owner')
	const tokenB = syntheticToken('another-admin')
	let currentToken = tokenA
	let refreshes = 0
	let reads = 0
	const grants = []
	const browserClient = compile(
		await read('packages/winwidget-web/src/shared/api/browser-client.ts'),
		{
			'@/shared/config/api.config': {
				API_URL: 'https://synthetic-api.example.test/api/v1'
			},
			axios: { default: axios },
			'./clear-session': { clearBrowserSession: () => {} },
			'./error': {
				errorCatch: () => '',
				getContentType: () => ({ 'Content-Type': 'application/json' })
			},
			'./token-storage': {
				getAccessToken: () => currentToken,
				isAccessTokenValid: validToken,
				saveTokenStorage: value => {
					currentToken = value
				}
			}
		}
	)
	const response = (config, data, status = 200) => ({
		data,
		status,
		statusText: 'synthetic',
		headers: {},
		config
	})
	const unauthorized = config =>
		new axios.AxiosError(
			'Unauthorized',
			'ERR_BAD_REQUEST',
			config,
			{},
			response(config, {}, 401)
		)
	const adapter = async config => {
		if (config.url === '/auth/refresh') {
			refreshes++
			return response(config, { accessToken: tokenB })
		}
		if (config.url === '/synthetic-read') {
			if (++reads === 1) throw unauthorized(config)
			return response(config, { ok: true })
		}
		assert.equal(
			config.url,
			`/subscriptions/admin/crm/${workspace}/extend-days`
		)
		grants.push(config)
		if (grants.length === 1) {
			await browserClient.axiosInterceptorsRequest.get('/synthetic-read')
			throw unauthorized(config)
		}
		return response(config, result())
	}
	browserClient.axiosClassicRequest.defaults.adapter = adapter
	browserClient.axiosInterceptorsRequest.defaults.adapter = adapter
	const api = compile(apiSource, {
		'@/shared/api': {
			...browserClient,
			getAccessToken: () => currentToken,
			isAccessTokenValid: validToken
		},
		jose: { decodeJwt },
		'../model/crm-subscriptions.contract': contract
	}).adminCrmSubscriptionsService
	await assert.rejects(
		() => api.extendDays(workspace, 'admin-owner', command()),
		error => error.response?.status === 401
	)
	assert.equal(currentToken, tokenB)
	assert.equal(
		refreshes,
		1,
		'Only the unrelated readonly request may refresh'
	)
	assert.equal(grants.length, 1, 'No automatic grant replay under actor B')
	assert.equal(grants[0].headers.Authorization, `Bearer ${tokenA}`)
	assert.equal(
		JSON.parse(grants[0].data).expectedActorSubject,
		'admin-owner'
	)
	await assert.rejects(
		() => api.extendDays(workspace, 'admin-owner', command()),
		contract.CrmAdminGrantNotSentError
	)
	assert.equal(
		grants.length,
		1,
		'Actor mismatch must fail before another POST'
	)
})

for (const [name, token] of [
	['absent token', null],
	['invalid token', 'not-a-token'],
	['expired token', syntheticToken('admin-owner', 1)],
	['different actor token', syntheticToken('another-admin')]
])
	test(`grant preflight rejects ${name} without POST, refresh or retry`, async () => {
		let posts = 0
		const api = compile(apiSource, {
			'@/shared/api': {
				getAccessToken: () => token,
				isAccessTokenValid: validToken,
				axiosClassicRequest: {
					post: () => {
						posts++
						throw new Error('Must not dispatch')
					}
				}
			},
			jose: { decodeJwt },
			'../model/crm-subscriptions.contract': contract
		}).adminCrmSubscriptionsService
		await assert.rejects(
			() => api.extendDays(workspace, 'admin-owner', command()),
			contract.CrmAdminGrantNotSentError
		)
		assert.equal(posts, 0)
	})
