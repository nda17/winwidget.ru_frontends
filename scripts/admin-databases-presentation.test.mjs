import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import * as sass from 'sass'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'

const require = createRequire(import.meta.url)
const { JSDOM } = createRequire(
	new URL('../apps/crm/package.json', import.meta.url)
)('jsdom')
const base = new URL(
	'../apps/admin-panel/src/screens/admin/ui/databases/',
	import.meta.url
)
const source = await readFile(new URL('AdminDatabases.tsx', base), 'utf8')
const sectionSource = await readFile(
	new URL('DatabaseSections.tsx', base),
	'utf8'
)
const scss = await readFile(
	new URL('AdminDatabases.module.scss', base),
	'utf8'
)
const compiledCss = (
	await postcss([
		tailwindcss({
			content: [{ raw: source + sectionSource, extension: 'tsx' }],
			corePlugins: { preflight: false }
		})
	]).process(sass.compileString(scss).css, { from: undefined })
).css
const styleNames = new Proxy({}, { get: (_, key) => key })
const compile = (value, fileName) =>
	ts.transpileModule(value, {
		fileName,
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			jsx: ts.JsxEmit.ReactJSX
		}
	}).outputText
const targets = [
	'notification-delivery',
	'campaigns',
	'reporting',
	'widgets',
	'billing',
	'identity',
	'platform',
	'support',
	'operations'
]

test('presentation keeps the approved backup/restore state machines and all 44 restore control bindings unchanged', () => {
	// AST fingerprints from reviewed baseline 213dd3516eab83fbf5510dcdaff3b1a3b5b591d8.
	// An intentional future behavioral change needs its own review and evidence.
	const file = ts.createSourceFile(
		'AdminDatabases.tsx',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX
	)
	const printer = ts.createPrinter({ removeComments: true })
	const print = node =>
		printer.printNode(ts.EmitHint.Unspecified, node, file)
	const hash = value => createHash('sha256').update(value).digest('hex')
	const variables = new Map()
	const visit = node => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
			variables.set(node.name.text, node.initializer)
		ts.forEachChild(node, visit)
	}
	visit(file)
	assert.equal(
		hash(print(variables.get('useDatabaseBackup'))),
		'51c63c0beba9fb4806b79bba6d01703114693e3ac76501c169ec33e1a97d1d19'
	)
	const restore = variables.get('DatabaseRestorePanel')
	assert.equal(
		hash(restore.body.statements.slice(0, -1).map(print).join('\n')),
		'b7caa1a6fc70316cf669722863c5b5266c1947d161cab31e61dbafd36fe41981'
	)
	const controls = []
	const control = node => {
		if (
			ts.isJsxAttribute(node) &&
			['onChange', 'onClick', 'disabled', 'value', 'accept'].includes(
				node.name.text
			)
		)
			controls.push(print(node))
		ts.forEachChild(node, control)
	}
	control(restore.body.statements.at(-1))
	assert.equal(controls.length, 44)
	assert.equal(
		hash(JSON.stringify(controls)),
		'44f21362224d81b2a6e9a04e4fe0daf754fede0ded50a44772c0c5dfb5aa6313'
	)
})

async function mount(
	t,
	{ role = 'DEV', backupEnabled = true, activeLoading = false } = {}
) {
	const dom = new JSDOM(
		'<!doctype html><html><head></head><body><div id="root"></div></body></html>',
		{ url: 'https://winwidget.test/admin/databases' }
	)
	const style = dom.window.document.createElement('style')
	style.textContent = compiledCss
	dom.window.document.head.append(style)
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
	const client = new query.QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Infinity, staleTime: Infinity }
		}
	})
	const calls = { mutations: [], toast: [] }
	const toast = message => calls.toast.push(message)
	toast.success = toast
	toast.error = toast
	toast.promise = () => {}
	const settings = {
		databaseBackupEnabled: backupEnabled,
		telegramBotTokenConfigured: true,
		dailySummaryChatId: 'synthetic-recipient',
		databaseBackupThreadId: 1
	}
	for (const target of targets)
		settings[
			(target === 'notification-delivery'
				? 'notificationDelivery'
				: target) + 'DatabaseBackupTimeLabel'
		] = '03:00'
	const restoreSettings = {
		enabled: false,
		currentServicesSha: 'a'.repeat(40),
		approved: null,
		permitRequired: true,
		maxFileSizeBytes: 1000000,
		allowedFileExtension: '.dump',
		targets: targets
			.filter(target => !['billing', 'operations'].includes(target))
			.map(id => ({
				id,
				label: id,
				confirmation: 'RESTORE ' + id,
				migrationManifestSha: 'b'.repeat(64)
			}))
	}
	client.setQueryData(['admin-telegram-bot-settings'], settings)
	client.setQueryData(['admin-telegram-database-backup-overview'], {
		databaseBackupEnabled: backupEnabled,
		items: targets.map(target => ({
			target,
			freshness: 'FRESH',
			latest: null,
			latestScheduled: null,
			latestManual: null,
			latestSuccessful: null,
			staleAfter: null
		}))
	})
	client.setQueryData(
		['admin-telegram-database-backup-history', 1, '', '', ''],
		{ items: [], totalPages: 1, total: 0 }
	)
	client.setQueryData(['admin-database-restore-settings'], restoreSettings)
	for (const target of targets)
		if (!activeLoading)
			client.setQueryData(
				[
					'admin-telegram-database-backup-active',
					target,
					'synthetic-admin'
				],
				null
			)
	const failMutation = async () => {
		calls.mutations.push('unexpected')
		throw Error('Synthetic mutation is forbidden')
	}
	const imports = {
		react: React,
		'react/jsx-runtime': require('react/jsx-runtime'),
		'react-hot-toast': { default: toast },
		'@tanstack/react-query': query,
		axios: { isAxiosError: () => false },
		'./AdminDatabases.module.scss': { default: styleNames },
		'@/entities/user': {
			UserRole: { ADMIN: 'ADMIN', DEV: 'DEV' },
			useUser: () => ({
				user: { id: 'synthetic-admin', rights: [role] },
				isLoading: false
			})
		},
		'@/features/manage-telegram-bot': {
			adminTelegramBotService: {
				get: async () => settings,
				getDatabaseBackupOverview: async () =>
					client.getQueryData(['admin-telegram-database-backup-overview']),
				getDatabaseBackupJobs: async () => ({
					items: [],
					totalPages: 1,
					total: 0
				}),
				getLatestActiveDatabaseBackupJob: () =>
					activeLoading ? new Promise(() => {}) : Promise.resolve(null),
				sendDatabaseBackup: failMutation
			}
		},
		'@/features/run-admin-task': {
			DATABASE_RESTORE_TARGETS: restoreSettings.targets.map(
				item => item.id
			),
			DATABASE_RESTORE_RECOVERY_ACTIONS: [
				'VERIFY_AS_IS',
				'ROLL_BACK_SAFETY',
				'ROLL_FORWARD_SOURCE'
			],
			devToolsService: new Proxy(
				{ getDatabaseRestoresSettings: async () => restoreSettings },
				{ get: (object, key) => object[key] ?? failMutation }
			)
		},
		'@/shared/api': { errorCatch: () => 'Синтетическая ошибка' },
		'@/shared/config/pages/admin.config': {
			ADMIN_PAGES: { TELEGRAM_BOT: '/admin/telegram-bot' }
		},
		'next/link': {
			default: ({ children, ...props }) =>
				React.createElement('a', props, children)
		},
		'@/shared/ui/heading/Heading': {
			default: ({ text }) => React.createElement('h1', {}, text)
		},
		'@/screens/admin/ui/common/admin-navigation/AdminNavigation': {
			default: () => null
		},
		'@/screens/admin/ui/common/admin-section-heading/AdminSectionHeading':
			{
				default: ({ title, description }) =>
					React.createElement(
						'header',
						{},
						React.createElement('h2', {}, title),
						React.createElement('p', {}, description)
					)
			},
		'@/screens/admin/ui/common/admin-tooltip/AdminTooltip': {
			default: ({ title }) => React.createElement('span', {}, title)
		},
		'@/shared/ui/pagination/Pagination': { default: () => null },
		'@/shared/ui/skeleton-loader/SkeletonLoader': {
			default: () => React.createElement('span', {}, 'Загрузка')
		}
	}
	const load = (value, name) => {
		const module = { exports: {} }
		new Function('exports', 'module', 'require', compile(value, name))(
			module.exports,
			module,
			id => {
				assert.ok(
					Object.hasOwn(imports, id),
					'Unexpected UI import: ' + id
				)
				return imports[id]
			}
		)
		return module.exports
	}
	imports['./DatabaseSections'] = load(
		sectionSource,
		'DatabaseSections.tsx'
	)
	const Component = load(source, 'AdminDatabases.tsx').default
	const container = dom.window.document.getElementById('root'),
		root = createRoot(container)
	await act(async () =>
		root.render(
			React.createElement(
				query.QueryClientProvider,
				{ client },
				React.createElement(Component)
			)
		)
	)
	t.after(async () => {
		await act(async () => root.unmount())
		client.clear()
		dom.window.close()
		for (const [key, descriptor] of previous)
			if (descriptor) Object.defineProperty(globalThis, key, descriptor)
			else delete globalThis[key]
	})
	const tabs = () => [...container.querySelectorAll('[role="tab"]')]
	const panel = name =>
		container.querySelector(
			'[id="' +
				tabs()
					.find(tab => tab.textContent === name)
					.getAttribute('aria-controls') +
				'"]'
		)
	return {
		container,
		calls,
		dom,
		tabs,
		panel,
		client,
		clickTab: async name =>
			act(async () =>
				tabs()
					.find(tab => tab.textContent === name)
					.click()
			),
		key: async (tab, key) =>
			act(async () =>
				tab.dispatchEvent(
					new dom.window.KeyboardEvent('keydown', { key, bubbles: true })
				)
			),
		change: async (input, value) =>
			act(async () => {
				const prototype =
					input.tagName === 'SELECT'
						? dom.window.HTMLSelectElement.prototype
						: dom.window.HTMLInputElement.prototype
				Object.getOwnPropertyDescriptor(prototype, 'value').set.call(
					input,
					value
				)
				input.dispatchEvent(
					new dom.window.Event(
						input.tagName === 'SELECT' ? 'change' : 'input',
						{ bubbles: true }
					)
				)
			})
	}
}

test('real React18 page exposes four accessible panels and actually hides inactive content with compiled styles', async t => {
	const ui = await mount(t)
	assert.deepEqual(
		ui.tabs().map(tab => tab.textContent),
		['Обзор', 'История', 'Расписание', 'Восстановление']
	)
	for (const tab of ui.tabs()) {
		const panel = ui.panel(tab.textContent)
		assert.equal(panel.getAttribute('aria-labelledby'), tab.id)
		assert.equal(
			ui.dom.window.getComputedStyle(panel).display === 'none',
			tab.textContent !== 'Обзор'
		)
	}
	assert.equal(ui.container.querySelectorAll('.targetPanel').length, 9)
	assert.equal(
		[...ui.container.querySelectorAll('.targetPanel')].filter(
			panel => ui.dom.window.getComputedStyle(panel).display !== 'none'
		).length,
		1
	)
	assert.deepEqual(ui.calls.mutations, [])
})

test('keyboard tab navigation supports arrows/Home/End with focus and one selected tab', async t => {
	const ui = await mount(t)
	await ui.key(ui.tabs()[0], 'ArrowLeft')
	assert.equal(ui.dom.window.document.activeElement, ui.tabs()[3])
	assert.equal(ui.tabs()[3].getAttribute('aria-selected'), 'true')
	await ui.key(ui.tabs()[3], 'Home')
	assert.equal(ui.dom.window.document.activeElement, ui.tabs()[0])
	await ui.key(ui.tabs()[0], 'ArrowRight')
	assert.equal(ui.dom.window.document.activeElement, ui.tabs()[1])
	await ui.key(ui.tabs()[1], 'End')
	assert.equal(ui.tabs().filter(tab => tab.tabIndex === 0).length, 1)
	assert.equal(ui.dom.window.document.activeElement, ui.tabs()[3])
	assert.ok(ui.calls.toast.length > 0)
})

test('tab and target changes retain mounted restore inputs, file nodes, history filters and all nine backup observers', async t => {
	const ui = await mount(t)
	await ui.clickTab('Восстановление')
	const lookup = ui
		.panel('Восстановление')
		.querySelector('input[placeholder="UUID задания"]')
	const file = ui
		.panel('Восстановление')
		.querySelector('input[type="file"]')
	await ui.change(lookup, '11111111-1111-4111-8111-111111111111')
	await ui.clickTab('История')
	const filter = ui.panel('История').querySelector('select')
	await ui.change(filter, 'widgets')
	await ui.clickTab('Обзор')
	const before = [...ui.container.querySelectorAll('.targetPanel')]
	await ui.change(ui.panel('Обзор').querySelector('select'), 'billing')
	assert.deepEqual(
		[...ui.container.querySelectorAll('.targetPanel')],
		before
	)
	assert.equal(
		ui.client
			.getQueryCache()
			.findAll({ queryKey: ['admin-telegram-database-backup-active'] })
			.filter(query => query.getObserversCount() > 0).length,
		9
	)
	await ui.clickTab('Восстановление')
	assert.equal(
		ui
			.panel('Восстановление')
			.querySelector('input[placeholder="UUID задания"]'),
		lookup
	)
	assert.equal(lookup.value, '11111111-1111-4111-8111-111111111111')
	assert.equal(
		ui.panel('Восстановление').querySelector('input[type="file"]'),
		file
	)
	await ui.clickTab('История')
	assert.equal(filter.value, 'widgets')
	assert.equal(ui.panel('История').querySelector('select'), filter)
	assert.deepEqual(ui.calls.mutations, [])
})

for (const role of ['ADMIN', 'DEV'])
	test(
		role +
			' sees honest disabled restore and read-only lookup; destructive controls remain guarded',
		async t => {
			const ui = await mount(t, { role })
			await ui.clickTab('Восстановление')
			const panel = ui.panel('Восстановление')
			assert.match(panel.textContent, /Восстановление пока недоступно/)
			assert.equal(panel.querySelector('details').open, false)
			assert.ok(panel.querySelector('input[placeholder="UUID задания"]'))
			if (role === 'ADMIN')
				assert.ok(panel.querySelector('[aria-disabled="true"]'))
			else
				assert.equal(
					[...panel.querySelectorAll('button')].find(
						button => button.textContent === 'Запросить допуск'
					).disabled,
					true
				)
			assert.deepEqual(ui.calls.mutations, [])
		}
	)

for (const options of [{ backupEnabled: false }, { activeLoading: true }])
	test(
		'backup button explains flag or pending admission without any automatic send: ' +
			JSON.stringify(options),
		async t => {
			const ui = await mount(t, options)
			const button = [
				...ui.panel('Обзор').querySelectorAll('button')
			].find(button => button.textContent === 'Создать копию')
			assert.equal(button.disabled, true)
			assert.ok(
				ui.container.querySelector(
					'[id="' + button.getAttribute('aria-describedby') + '"]'
				).textContent.length > 20
			)
			assert.deepEqual(ui.calls.mutations, [])
		}
	)

test('schedule uses current settings and the existing Telegram settings route, not a new endpoint', async t => {
	const ui = await mount(t)
	await ui.clickTab('Расписание')
	const panel = ui.panel('Расписание')
	assert.equal(panel.querySelectorAll('li').length, 9)
	assert.equal(
		panel.querySelector('a').getAttribute('href'),
		'/admin/telegram-bot'
	)
	assert.doesNotMatch(
		source,
		/adminTelegramBotService\.(?:update|patch|put|setSchedule)/
	)
	assert.deepEqual(ui.calls.mutations, [])
})
