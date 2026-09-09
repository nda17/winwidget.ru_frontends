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
	const code = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			jsx: ts.JsxEmit.ReactJSX
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
const source = await read(
	'apps/admin-panel/src/screens/admin/ui/support/AdminSupport.tsx'
)
const settingsSource = await read(
	'apps/admin-panel/src/screens/admin/ui/support/SupportNotificationSettings.tsx'
)
const id = '11111111-1111-4111-8111-111111111111'
const date = '2026-09-09T00:00:00.000Z'
const conversation = {
	id,
	number: 1,
	authorSubject: 'client',
	authorName: 'Клиент',
	workspaceId: null,
	companyName: null,
	subject: 'Подписка',
	status: 'NEW',
	section: 'inbox',
	appVersion: '0.1.0',
	lastSequence: 1,
	version: 1,
	unreadCount: 0,
	createdAt: date,
	updatedAt: date,
	lastMessageAt: date
}
const settings = {
	version: 1,
	enabled: true,
	emailEnabled: true,
	staffEmails: ['support@example.test'],
	telegramEnabled: false,
	telegramChatId: null,
	telegramThreadId: null,
	telegramBot: 'SUPPORT',
	clientEmailEnabled: true
}

async function mount(t, rights = ['ADMIN']) {
	const state = {
		auth: true,
		isAuthResolved: true,
		actor: 'operator',
		profileActor: 'operator',
		rights
	}
	const dom = new JSDOM('<!doctype html><div id="root"></div>', {
		url: `https://winwidget.test/admin/support?conversationId=${id}`
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
	dom.window.HTMLElement.prototype.scrollIntoView = () => {}
	const React = require('react')
	assert.match(React.version, /^18\./)
	const { act } = React
	const { createRoot } = require('react-dom/client')
	const query = require('@tanstack/react-query')
	const client = new query.QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: Infinity } }
	})
	const calls = { replies: [], settings: [] }
	const api = {
		list: async () => ({
			items: [conversation],
			total: 1,
			page: 1,
			limit: 20
		}),
		detail: async () => conversation,
		history: async () => ({
			items: [
				{
					id,
					conversationId: id,
					senderKind: 'OPERATOR',
					senderName: 'Личное имя оператора',
					text: 'Ответ специалиста',
					sequence: 1,
					createdAt: date,
					attachments: []
				}
			],
			hasMore: false,
			lastSequence: 1
		}),
		read: async () => ({ throughSequence: 1 }),
		settings: async () => settings,
		reply: async (_actor, _id, command) => {
			calls.replies.push(command)
			throw new Error('Связь прервана')
		},
		saveSettings: async (_actor, command) => {
			calls.settings.push(command)
			throw new Error('Настройки не сохранены')
		}
	}
	const useAuthStore = Object.assign(selector => selector(state), {
		getState: () => state
	})
	const block = ({ text, children }) =>
		React.createElement('div', null, text, children)
	const imports = {
		react: React,
		'react/jsx-runtime': require('react/jsx-runtime'),
		'@tanstack/react-query': query,
		'next/navigation': {
			useSearchParams: () => new URLSearchParams({ conversationId: id }),
			useRouter: () => ({ replace: () => {} })
		},
		'@/entities/user': {
			useAuthStore,
			UserRole: { ADMIN: 'ADMIN', DEV: 'DEV' },
			useUser: () => ({
				user: { id: state.profileActor, rights: state.rights },
				isLoading: !state.isAuthResolved
			})
		},
		'@/features/admin-support': {
			...contract,
			adminSupportApi: api,
			supportActorIsCurrent: actor => actor === state.actor,
			SupportAdminError: class extends Error {}
		},
		'@/screens/admin/ui/common/admin-navigation/AdminNavigation': {
			default: block
		},
		'@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading':
			{ default: block },
		'@/shared/ui/heading/Heading': { default: block },
		'@/screens/admin/ui/common/admin-tooltip/AdminTooltip': {
			default: ({ title }) => React.createElement('span', null, title)
		},
		'./AdminSupport.module.scss': { default: {} }
	}
	imports['./SupportNotificationSettings'] = compile(
		settingsSource,
		imports
	)
	const Component = compile(source, imports).default
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
			await new Promise(resolve => setTimeout(resolve, 10))
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
	for (let i = 0; i < 4; i++) await flush()
	return {
		state,
		calls,
		container,
		render,
		flush,
		change: async value => {
			const input = container.querySelector('textarea')
			assert.ok(input)
			await act(async () => {
				Object.getOwnPropertyDescriptor(
					dom.window.HTMLTextAreaElement.prototype,
					'value'
				).set.call(input, value)
				input.dispatchEvent(
					new dom.window.Event('input', { bubbles: true })
				)
			})
		},
		click: async label => {
			const button = [...container.querySelectorAll('button')].find(
				element => element.textContent.trim() === label
			)
			assert.ok(button, label)
			await act(async () => button.click())
			await flush()
		}
	}
}

test('ADMIN sees the conversation and settings but cannot edit DEV notification settings', async t => {
	const h = await mount(t)
	assert.match(h.container.textContent, /Специалист поддержки/)
	assert.doesNotMatch(h.container.textContent, /Личное имя оператора/)
	assert.match(h.container.textContent, /support@example.test/)
	assert.equal(h.container.querySelector('fieldset').disabled, true)
	assert.equal(
		[...h.container.querySelectorAll('button')].some(
			button => button.textContent === 'Сохранить настройки'
		),
		false
	)
})
test('same-actor session renewal preserves the editor draft and blocks sending until ready', async t => {
	const h = await mount(t)
	await h.change('Ответ до обновления токена')
	h.state.isAuthResolved = false
	await h.render()
	assert.equal(
		h.container.querySelector('textarea').value,
		'Ответ до обновления токена'
	)
	assert.equal(
		[...h.container.querySelectorAll('button')].find(
			button => button.textContent === 'Отправить ответ'
		).disabled,
		true
	)
	assert.equal(h.calls.replies.length, 0)
	h.state.isAuthResolved = true
	await h.render()
	await h.click('Отправить ответ')
	assert.equal(h.calls.replies.length, 1)
	assert.match(h.container.textContent, /Связь прервана/)
	await h.click('Повторить ответ')
	assert.equal(h.calls.replies[0], h.calls.replies[1])
	assert.equal(h.calls.replies[1].text, 'Ответ до обновления токена')
})
test('switching actor removes the previous private draft before the new profile arrives', async t => {
	const h = await mount(t)
	await h.change('Личный черновик')
	h.state.actor = 'another-operator'
	await h.render()
	assert.equal(h.container.querySelector('textarea'), null)
	h.state.profileActor = 'another-operator'
	await h.render()
	for (let i = 0; i < 4; i++) await h.flush()
	assert.equal(h.container.querySelector('textarea').value, '')
	assert.equal(h.calls.replies.length, 0)
})
test('DEV settings save failure remains inline and retries the original command', async t => {
	const h = await mount(t, ['DEV'])
	assert.equal(h.container.querySelector('fieldset').disabled, false)
	await h.click('Сохранить настройки')
	assert.match(h.container.textContent, /Настройки не сохранены/)
	await h.click('Повторить сохранение')
	assert.equal(h.calls.settings.length, 2)
	assert.equal(h.calls.settings[0], h.calls.settings[1])
})
