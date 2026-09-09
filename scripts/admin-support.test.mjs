import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import axios from 'axios'

const read = path =>
	readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = (source, imports = {}) => {
	const code = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022
		}
	}).outputText
	const module = { exports: {} }
	new Function('exports', 'module', 'require', code)(
		module.exports,
		module,
		name => {
			assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`)
			return imports[name]
		}
	)
	return module.exports
}
const contract = compile(
	await read('packages/winwidget-web/src/shared/lib/support-contract.ts')
)
const apiSource = await read(
	'packages/winwidget-web/src/features/admin-support/api/support.api.ts'
)
const id = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const settings = {
	version: 1,
	enabled: false,
	emailEnabled: false,
	staffEmails: [],
	telegramEnabled: false,
	telegramChatId: null,
	telegramThreadId: null,
	telegramBot: 'SUPPORT',
	clientEmailEnabled: true
}
const command = {
	commandId: id,
	expectedActorSubject: 'operator',
	expectedVersion: 1,
	enabled: false,
	emailEnabled: false,
	staffEmails: [],
	telegramEnabled: false,
	telegramChatId: null,
	telegramThreadId: null,
	clientEmailEnabled: true
}
const harness = handler => {
	let token = 'operator:old'
	const calls = []
	let refreshes = 0
	const module = compile(apiSource, {
		'@/shared/api': {
			getAccessToken: () => token,
			isAccessTokenValid: () => true,
			axiosClassicRequest: {
				request: async input => {
					calls.push(input)
					return handler(input, calls.length)
				}
			}
		},
		'@/shared/api/browser-client': {
			refreshAccessToken: async () => {
				refreshes++
				token = 'operator:renewed'
			}
		},
		'@/shared/config/api.config': {
			API_URL: 'https://example.test/api/v1'
		},
		jose: { decodeJwt: token => ({ sub: token.split(':')[0] }) },
		axios: axios,
		'@/shared/lib/support-contract': contract
	})
	return {
		api: module.adminSupportApi,
		calls,
		get refreshes() {
			return refreshes
		},
		switchActor: () => {
			token = 'different:token'
		}
	}
}
test('admin settings mutation renews a 401 session without automatically replaying the command', async () => {
	const h = harness((_input, count) => {
		if (count === 1)
			throw { isAxiosError: true, response: { status: 401 } }
		return { data: { ...settings, version: 2 } }
	})
	await assert.rejects(
		h.api.saveSettings('operator', command),
		/Сессия обновлена/
	)
	assert.equal(h.calls.length, 1)
	assert.equal(h.refreshes, 1)
	await h.api.saveSettings('operator', command)
	assert.equal(h.calls.length, 2)
	assert.equal(h.calls[1].data, h.calls[0].data)
	assert.equal(h.calls[1].headers.Authorization, 'Bearer operator:renewed')
})
test('admin commands refuse to follow an account switch before HTTP', async () => {
	const h = harness(() => ({ data: settings }))
	h.switchActor()
	await assert.rejects(
		h.api.saveSettings('operator', command),
		/Учётная запись изменилась/
	)
	assert.equal(h.calls.length, 0)
})
test('late admin responses are rejected after the active account changes', async () => {
	let finish
	const h = harness(
		() =>
			new Promise(resolve => {
				finish = resolve
			})
	)
	const result = h.api.settings('operator')
	await new Promise(resolve => setImmediate(resolve))
	h.switchActor()
	finish({ data: settings })
	await assert.rejects(result, /Учётная запись изменилась/)
})
test('history rejects another conversation and out-of-order sequences', () => {
	const message = {
		id,
		conversationId: id,
		senderKind: 'CLIENT',
		senderName: null,
		text: 'Сообщение',
		sequence: 1,
		createdAt: '2026-09-09T00:00:00.000Z',
		attachments: []
	}
	assert.throws(() =>
		contract.parseSupportHistory(
			{ items: [message], hasMore: false, lastSequence: 1 },
			other
		)
	)
	assert.throws(() =>
		contract.parseSupportHistory(
			{
				items: [{ ...message, sequence: 2 }, message],
				hasMore: false,
				lastSequence: 2
			},
			id
		)
	)
})
test('attachment contract rejects executable formats, oversized bodies, and decompression bombs', () => {
	const attachment = {
		id,
		fileName: 'screen.png',
		mediaType: 'image/png',
		byteSize: 100,
		width: 100,
		height: 100
	}
	assert.deepEqual(contract.parseSupportAttachment(attachment), attachment)
	for (const patch of [
		{ mediaType: 'image/svg+xml' },
		{ byteSize: 6 * 1024 * 1024 },
		{ width: 50000, height: 50000 }
	])
		assert.throws(() =>
			contract.parseSupportAttachment({ ...attachment, ...patch })
		)
})
test('CRM section context excludes record IDs and all query parameters', () => {
	assert.equal(
		contract.supportSection('/customers/private-record'),
		'customers'
	)
	assert.equal(
		contract.supportSection('/unexpected/private-record'),
		'other'
	)
})
