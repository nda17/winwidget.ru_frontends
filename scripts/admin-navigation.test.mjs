import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const load = (path, dependencies = {}) => {
	const module = { exports: {} }
	const source = ts.transpileModule(read(path), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022
		}
	}).outputText
	new Function('require', 'module', 'exports', source)(
		specifier => {
			assert.ok(
				specifier in dependencies,
				`Unexpected dependency: ${specifier}`
			)
			return dependencies[specifier]
		},
		module,
		module.exports
	)
	return module.exports
}
const pages = load(
	'packages/winwidget-web/src/shared/config/pages/admin.config.ts'
)
const { adminNavGroups, isAdminNavItemActive } = load(
	'apps/admin-panel/src/screens/admin/ui/common/admin-navigation/data/admin-navigation.data.ts',
	{ '@/shared/config/pages/admin.config': pages }
)
const items = adminNavGroups.flatMap(group => group.items)

test('six meaningful groups preserve every remaining admin page exactly once', () => {
	assert.deepEqual(
		adminNavGroups.map(group => group.id),
		[
			'overview',
			'products',
			'finance',
			'content',
			'operations',
			'management'
		]
	)
	assert.equal(items.length, 17)
	assert.equal(new Set(items.map(item => item.link)).size, items.length)
	const expected = Object.entries(pages.ADMIN_PAGES)
		.filter(([key]) => key !== 'USER')
		.map(([, value]) => value)
	assert.deepEqual(items.map(item => item.link).sort(), expected.sort())
	for (const item of items) {
		assert.ok(
			existsSync(
				new URL(`apps/admin-panel/src/app${item.link}/page.tsx`, root)
			),
			item.link
		)
		assert.equal(
			items.filter(candidate => isAdminNavItemActive(item.link, candidate))
				.length,
			1
		)
	}
})

test('nested users and widget editors select their page without prefix collisions', () => {
	const user = items.find(item => item.link === '/admin/user-list')
	const widgets = items.find(item => item.link === '/admin/widgets')
	assert.equal(
		isAdminNavItemActive('/admin/user/edit/user-42', user),
		true
	)
	assert.equal(
		isAdminNavItemActive('/admin/widgets/wheel/widget-42', widgets),
		true
	)
	for (const path of [
		'/admin/user-list-extra',
		'/admin/users',
		'/admin/widgetsmith',
		'/administrator',
		'/admin/backlog'
	]) {
		assert.equal(
			items.some(item => isAdminNavItemActive(path, item)),
			false,
			path
		)
	}
})

test('Backlog UI, API entity and blanket danger banner are removed', () => {
	for (const path of [
		'apps/admin-panel/src/app/admin/backlog/page.tsx',
		'apps/admin-panel/src/screens/admin/ui/notes/AdminNotes.tsx',
		'packages/winwidget-web/src/entities/note/api/note.api.ts',
		'apps/admin-panel/src/screens/admin/ui/common/admin-danger-banner/AdminDangerBanner.tsx'
	])
		assert.equal(existsSync(new URL(path, root)), false, path)
	assert.ok(!('BACKLOG' in pages.ADMIN_PAGES))
	assert.doesNotMatch(
		read(
			'packages/winwidget-web/src/features/view-event-log/api/event-log.api.ts'
		),
		/BACKLOG/
	)
})

test('navigation has current-location semantics, keyboard focus and mobile touch targets', () => {
	const base =
		'apps/admin-panel/src/screens/admin/ui/common/admin-navigation/'
	assert.match(
		read(`${base}AdminNavItem.tsx`),
		/aria-current=\{isActive \? 'page'/
	)
	assert.match(
		read(`${base}AdminNavigation.tsx`),
		/aria-label="Разделы панели"/
	)
	const styles = read(`${base}AdminNavigation.module.scss`)
	assert.match(styles, /min-h-\[44px\]/)
	assert.match(styles, /focus-visible:ring-2/)
	assert.match(styles, /max-width: 540px/)
	assert.doesNotMatch(styles, /white-space:\s*nowrap|whitespace-nowrap/)
})

test('admin workspaces share fluid width without nested panel caps or extra page gutters', () => {
	const base = 'apps/admin-panel/src/screens/admin/ui/'
	for (const path of [
		'Admin',
		'widgets/AdminWidgets',
		'crm/AdminCrm',
		'payments/AdminPayments',
		'affiliate/AdminAffiliate',
		'alerts/AdminAlerts',
		'subscriptions/AdminSubscriptions',
		'user-list/UserList',
		'user/edit/UserEdit',
		'event-log/AdminEventLog',
		'mailings/AdminMailings',
		'messaging/AdminMessaging',
		'databases/AdminDatabases',
		'system/AdminSystem',
		'settings/AdminSettings',
		'tariffs/AdminTariffs',
		'telegram-bot/AdminTelegramBot',
		'content-settings/AdminContentSettings'
	]) {
		const styles = read(`${base}${path}.module.scss`)
		const wrapper = styles.match(/^\.wrapper \{([^}]+)\}/)?.[1]
		assert.ok(wrapper, path)
		assert.match(
			wrapper,
			/@apply relative flex w-full min-w-0 flex-col;/,
			path
		)
		assert.doesNotMatch(
			styles,
			/max-w-\[(?:88rem|600px|680px|760px|900px|920px|1100px)\]/,
			path
		)
	}
	assert.doesNotMatch(
		read(
			`${base}content-settings/home-content-editor/HomeContentEditor.module.scss`
		),
		/max-w-\[1100px\]/
	)
	assert.match(
		read(`${base}messaging/AdminMessaging.module.scss`),
		/@media \(max-width: 480px\) \{\s*@apply grid-cols-1;/
	)
})

test('unreleased CRM keeps its reference screen but never starts backend queries', () => {
	const base = 'apps/admin-panel/src/screens/admin/ui/crm/'
	assert.match(
		read(`${base}AdminCrm.tsx`),
		/enabled: CRM_RELEASE.apiEnabled && isAuthResolved && auth/
	)
	assert.match(
		read(`${base}CrmPricingSettings.tsx`),
		/enabled: CRM_RELEASE.apiEnabled && canView/
	)
	assert.match(
		read(`${base}CrmPricingSettings.tsx`),
		/const canEdit =\s*CRM_RELEASE.apiEnabled && canView/
	)
	assert.match(
		read(`${base}AdminCrm.tsx`),
		/<details className=\{styles.architecture\}>/
	)
	for (const file of ['AdminCrm.tsx', 'CrmPricingSettings.tsx']) {
		assert.match(
			read(`${base}${file}`),
			/if \(\s*!CRM_RELEASE.apiEnabled \|\|/
		)
	}
})
