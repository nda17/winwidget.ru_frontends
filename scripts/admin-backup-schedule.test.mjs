import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const read = path =>
	readFile(new URL('../' + path, import.meta.url), 'utf8')
const source = await read(
	'apps/admin-panel/src/screens/admin/ui/telegram-bot/AdminTelegramBot.tsx'
)
const apiSource = await read(
	'packages/winwidget-web/src/features/manage-telegram-bot/api/telegram-bot.api.ts'
)
const restoreSource = await read(
	'packages/winwidget-web/src/features/run-admin-task/api/dev-tools.api.ts'
)
const parse = source =>
	ts.createSourceFile(
		'fixture.tsx',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX
	)
const file = parse(source)
const findNodes = (root, predicate) => {
	const result = []
	const visit = node => {
		if (predicate(node)) result.push(node)
		ts.forEachChild(node, visit)
	}
	visit(root)
	return result
}
const variables = new Map(
	findNodes(file, ts.isVariableDeclaration).map(node => [
		node.name.getText(file),
		node.initializer
	])
)
const compile = value =>
	ts.transpileModule(value, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022
		}
	}).outputText
const helperNames = [
	'MIN_TASK_TIME_GAP_MINUTES',
	'getTimeMinutes',
	'getTaskTimeGapMinutes',
	'addMinutesToTime',
	'hasMinimumTaskTimeGap'
]
const helperSource = helperNames
	.map(name => `const ${name} = ${variables.get(name).getText(file)};`)
	.join('\n')
const evaluate = (expression, values = {}) =>
	new Function(
		...Object.keys(values),
		compile(helperSource + '\nreturn (' + expression + ');')
	)(...Object.values(values))
const targets = [
	'notification-delivery',
	'campaigns',
	'reporting',
	'widgets',
	'billing',
	'identity',
	'platform',
	'support',
	'operations',
	'crm-access',
	'crm-intake',
	'crm-customers',
	'crm-sales'
]
const prefix = target =>
	target.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
const delayFields = targets.map(
	target => prefix(target) + 'DatabaseBackupDelayMinutes'
)
const settings = Object.fromEntries(
	targets.flatMap((target, index) => [
		[prefix(target) + 'DatabaseBackupDelayMinutes', (index + 1) * 15],
		[prefix(target) + 'DatabaseBackupTime', '04:00'],
		[prefix(target) + 'DatabaseBackupTimeLabel', '04:00 МСК']
	])
)

test('backup API adds only four CRM targets and twelve schedule fields; restore retains its independent seven-target allowlist', () => {
	const api = parse(apiSource)
	const union = api.statements.find(
		node =>
			ts.isTypeAliasDeclaration(node) &&
			node.name.text === 'TelegramDatabaseBackupTarget'
	)
	assert.deepEqual(
		union.type.types.map(node => node.literal.text),
		targets
	)
	const fields = api.statements.find(
		node =>
			ts.isInterfaceDeclaration(node) &&
			node.name.text === 'AdminTelegramBotSettings'
	).members
	for (const target of targets.slice(9))
		for (const [suffix, kind] of [
			['DelayMinutes', ts.SyntaxKind.NumberKeyword],
			['Time', ts.SyntaxKind.StringKeyword],
			['TimeLabel', ts.SyntaxKind.StringKeyword]
		]) {
			const field = fields.find(
				node =>
					node.name.text === prefix(target) + 'DatabaseBackup' + suffix
			)
			assert.ok(field)
			assert.equal(field.type.kind, kind)
		}
	const restore = parse(restoreSource)
	const allowlist = findNodes(restore, ts.isVariableDeclaration).find(
		node => node.name.getText(restore) === 'DATABASE_RESTORE_TARGETS'
	)
	assert.deepEqual(
		allowlist.initializer.expression.elements.map(node => node.text),
		[
			'notification-delivery',
			'campaigns',
			'reporting',
			'widgets',
			'identity',
			'platform',
			'support'
		]
	)
})

for (const handler of [
	'handleSaveDailySummary',
	'handleSaveBackupSchedule'
])
	test(
		handler +
			' checks the actual thirteen server delays, including CRM and midnight wraparound',
		() => {
			const calls = findNodes(
				variables.get(handler),
				node =>
					ts.isCallExpression(node) &&
					node.expression.getText(file) === 'hasMinimumTaskTimeGap'
			)
			assert.equal(calls.length, 1)
			const delayArray = calls[0].arguments[2]
			assert.deepEqual(
				delayArray.elements.map(node => node.name.text),
				delayFields
			)
			const delays = evaluate(delayArray.getText(file), { settings })
			assert.deepEqual(
				delays,
				[15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195]
			)
			for (const backupTime of ['02:00', '23:00']) {
				for (const delay of delays) {
					const summaryTime = evaluate(
						'addMinutesToTime(backupTime, delay)',
						{ backupTime, delay }
					)
					assert.equal(
						evaluate(
							'hasMinimumTaskTimeGap(summaryTime, backupTime, delays)',
							{ summaryTime, backupTime, delays }
						),
						false
					)
				}
			}
			assert.equal(
				evaluate("hasMinimumTaskTimeGap('02:19', '23:00', delays)", {
					delays
				}),
				false
			)
			assert.equal(
				evaluate("hasMinimumTaskTimeGap('02:20', '23:00', delays)", {
					delays
				}),
				true
			)
			assert.equal(
				evaluate("hasMinimumTaskTimeGap('04:00', '23:00', delays)", {
					delays
				}),
				true
			)
		}
	)

test('all thirteen draft previews use server offsets, preserve midnight wrap and fall back only for an invalid draft', () => {
	const expected = [
		'23:15',
		'23:30',
		'23:45',
		'00:00',
		'00:15',
		'00:30',
		'00:45',
		'01:00',
		'01:15',
		'01:30',
		'01:45',
		'02:00',
		'02:15'
	]
	for (const [index, target] of targets.entries()) {
		const expression = variables
			.get(prefix(target) + 'BackupTime')
			.getText(file)
		assert.equal(
			evaluate(expression, { settings, backupTime: '23:00' }),
			expected[index]
		)
		assert.equal(
			evaluate(expression, { settings, backupTime: '' }),
			'04:00'
		)
		assert.equal(
			evaluate(expression, { settings: undefined, backupTime: '23:00' }),
			null
		)
	}
	const changed = { ...settings, crmSalesDatabaseBackupDelayMinutes: 210 }
	assert.equal(
		evaluate(variables.get('crmSalesBackupTime').getText(file), {
			settings: changed,
			backupTime: '23:00'
		}),
		'02:30'
	)
})

test('CRM schedule labels and derived preview fields have one JSX binding each', () => {
	const settingsLabels = findNodes(
		file,
		node =>
			ts.isPropertyAccessExpression(node) &&
			/^crm(?:Access|Intake|Customers|Sales)DatabaseBackupTimeLabel$/.test(
				node.name.text
			)
	)
	assert.deepEqual(
		settingsLabels.map(node => node.name.text),
		targets
			.slice(9)
			.map(target => prefix(target) + 'DatabaseBackupTimeLabel')
	)
	for (const name of ['Access', 'Intake', 'Customers', 'Sales']) {
		const labels = findNodes(
			file,
			node =>
				ts.isJsxText(node) && node.text.trim() === 'Backup CRM ' + name
		)
		assert.equal(labels.length, 1)
		const field = labels[0].parent.parent
		const namePrefix = 'crm' + name
		assert.ok(field.getText(file).includes(namePrefix + 'BackupTime'))
	}
})

test('CRM manual backups use existing per-target routes and the unchanged idempotency header', async () => {
	const calls = []
	const request = new Proxy(
		{},
		{
			get:
				(_, method) =>
				async (...args) => {
					calls.push([method, ...args])
					return { data: { synthetic: true } }
				}
		}
	)
	const module = { exports: {} }
	new Function('exports', 'module', 'require', compile(apiSource))(
		module.exports,
		module,
		id => {
			assert.equal(id, '@/shared/api')
			return { axiosInterceptorsRequest: request }
		}
	)
	for (const target of targets.slice(9)) {
		await module.exports.default.sendDatabaseBackup(
			target,
			'synthetic-command-' + target
		)
		assert.deepEqual(calls.at(-1), [
			'post',
			`/telegram-bot/admin/database-backups/${target}/send`,
			undefined,
			{ headers: { 'Idempotency-Key': 'synthetic-command-' + target } }
		])
		await module.exports.default.getLatestActiveDatabaseBackupJob(target)
		assert.deepEqual(calls.at(-1), [
			'get',
			`/telegram-bot/admin/database-backups/${target}/jobs/active`
		])
	}
})
