import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const read = relative =>
	readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
const navigation = 'packages/winwidget-web/src/shared/lib/navigation/'
const compile = (relative, modules = {}, globals = {}) => {
	const compiled = ts.transpileModule(read(relative), {
		fileName: relative,
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			jsx: ts.JsxEmit.ReactJSX,
			esModuleInterop: true
		}
	}).outputText
	const loadedModule = { exports: {} }
	new Function(
		'exports',
		'module',
		'require',
		'process',
		'window',
		compiled
	)(
		loadedModule.exports,
		loadedModule,
		name => {
			assert.ok(Object.hasOwn(modules, name), `Unmocked import: ${name}`)
			return modules[name]
		},
		{ env: globals.env ?? {} },
		globals.window
	)
	return loadedModule.exports
}

const zones = compile(`${navigation}frontend-zones.ts`)
const zoneNames = ['landing', 'widgets', 'admin-panel']
const widgetPrefixes = [
	'cabinet',
	'payment',
	'login',
	'register',
	'restore-password',
	'social-auth',
	'logout',
	'wheels',
	'quizzes',
	'callbacks',
	'timers',
	'stop-offers',
	'calculators',
	'page-wheel',
	'page-quiz',
	'page-callback',
	'page-timer',
	'page-stop-offer',
	'page-ai-consultant',
	'page-calculator'
]
const jsx = (type, props) => ({ type, props })
const jsxRuntime = { jsx, jsxs: jsx }
const NextLink = () => null
const linkForZone = zone =>
	compile(`${navigation}ZoneLink.tsx`, {
		'next/link': NextLink,
		react: { forwardRef: render => render },
		'react/jsx-runtime': jsxRuntime,
		'./frontend-zones': {
			needsDocumentNavigation: href =>
				zones.needsDocumentNavigation(href, zone)
		}
	}).default

const routerForZone = zone => {
	const calls = []
	const nextRouter = Object.fromEntries(
		['push', 'replace', 'prefetch', 'back', 'forward', 'refresh'].map(
			method => [
				method,
				(...args) => calls.push(['next', method, ...args])
			]
		)
	)
	const window = {
		location: {
			assign: href => calls.push(['document', 'assign', href]),
			replace: href => calls.push(['document', 'replace', href])
		}
	}
	const { useZoneRouter: createRouter } = compile(
		`${navigation}useZoneRouter.ts`,
		{
			'next/navigation': { useRouter: () => nextRouter },
			react: { useMemo: factory => factory() },
			'./frontend-zones': {
				needsDocumentNavigation: href =>
					zones.needsDocumentNavigation(href, zone)
			}
		},
		{ window }
	)
	return { router: createRouter(), calls, nextRouter }
}

test('every existing main application page belongs to its build-time zone', () => {
	for (const app of zoneNames) {
		const base = new URL(`../apps/${app}/src/app/`, import.meta.url)
		const collect = (directory, parts = []) => {
			for (const entry of readdirSync(directory, {
				withFileTypes: true
			})) {
				if (entry.isDirectory())
					collect(
						new URL(`${encodeURIComponent(entry.name)}/`, directory),
						[...parts, entry.name]
					)
				else if (entry.name === 'page.tsx') {
					const route =
						'/' +
						parts
							.filter(part => !part.startsWith('('))
							.map(part => (part.startsWith('[') ? 'example' : part))
							.join('/')
					assert.equal(zones.zoneForPath(route), app, `${app}: ${route}`)
					for (const suffix of [
						'',
						'?tab=history&returnUrl=%2Fadmin',
						'#details',
						'?tab=1#details'
					]) {
						for (const current of zoneNames) {
							assert.equal(
								zones.needsDocumentNavigation(route + suffix, current),
								app !== current,
								`${current} -> ${route}${suffix}`
							)
						}
					}
				}
			}
		}
		collect(base)
	}
})

test('legacy route prefixes and segment boundaries remain exact', () => {
	for (const prefix of widgetPrefixes) {
		assert.equal(zones.zoneForPath(`/${prefix}`), 'widgets')
		assert.equal(zones.zoneForPath(`/${prefix}/example`), 'widgets')
		assert.equal(zones.zoneForPath(`/${prefix}-unrelated`), 'landing')
	}
	assert.equal(zones.zoneForPath('/admin'), 'admin-panel')
	assert.equal(zones.zoneForPath('/admin/crm'), 'admin-panel')
	assert.equal(zones.zoneForPath('/administrator'), 'landing')
	assert.equal(zones.zoneForPath('/legal-documentation/oferta'), 'landing')
	assert.equal(zones.zoneForPath('/'), 'landing')
})

test('zone comes only from the compile-time app identity', () => {
	for (const value of [
		undefined,
		'',
		'LANDING',
		'unknown',
		...zoneNames
	]) {
		const configuredZones = compile(
			`${navigation}frontend-zones.ts`,
			{},
			{ env: { NEXT_PUBLIC_FRONTEND_APP: value } }
		)
		assert.equal(
			configuredZones.currentFrontendZone(),
			['widgets', 'admin-panel'].includes(value) ? value : 'landing'
		)
	}
})

test('fragment/query-only navigation stays local', () => {
	for (const zone of zoneNames) {
		for (const href of [
			'#0',
			'#pricing',
			'?tab=history',
			'?returnUrl=%2Fadmin#result'
		]) {
			assert.equal(zones.needsDocumentNavigation(href, zone), false)
		}
	}
})

test('widget landing is the only marketing layout without changing application routing', () => {
	const pages = compile(
		'packages/winwidget-web/src/shared/config/pages/public.config.ts'
	)
	const { staticMenu, usesApplicationMenu } = compile(
		'packages/winwidget-web/src/app/_ui/layout/nav-menu/data/menu.data.ts',
		{
			'@/shared/config/pages/public.config': pages,
			'@/shared/config/crm-release.config': compile(
				'packages/winwidget-web/src/shared/config/crm-release.config.ts'
			)
		}
	)
	assert.deepEqual(
		staticMenu.items.map(({ title, link }) => [title, link]),
		[
			['Главная', '/'],
			['CRM', 'https://crm.winwidget.ru']
		]
	)
	for (const pathname of ['/']) {
		assert.equal(pages.isMarketingPage(pathname), true)
		assert.equal(zones.zoneForPath(pathname), 'landing')
		assert.equal(usesApplicationMenu(pathname, 'landing'), false)
	}
	for (const pathname of [
		'/products',
		'/products/widgets',
		'/products/crm',
		'/products/crm/',
		'/products/crm/private',
		'/products/widgets/extra',
		'/cabinet',
		'/payment',
		'/admin',
		'/login'
	]) {
		assert.equal(pages.isMarketingPage(pathname), false, pathname)
	}
	for (const pathname of [
		'/login',
		'/register',
		'/restore-password',
		'/social-auth',
		'/social-auth/google',
		'/logout'
	]) {
		assert.equal(usesApplicationMenu(pathname, 'widgets'), false)
	}
	for (const pathname of [
		'/cabinet',
		'/payment',
		'/wheels/example',
		'/quizzes/example'
	]) {
		assert.equal(usesApplicationMenu(pathname, 'widgets'), true)
		assert.equal(zones.zoneForPath(pathname), 'widgets')
	}
	assert.equal(usesApplicationMenu('/admin/content', 'admin-panel'), true)
})

test('working CRM links use its own origin without enabling release or adding authentication parameters', () => {
	for (const [nodeEnv, expected] of [
		[undefined, 'https://crm.winwidget.ru'],
		['production', 'https://crm.winwidget.ru'],
		['test', 'https://crm.winwidget.ru'],
		['development', 'http://localhost:3001']
	]) {
		const release = compile(
			'packages/winwidget-web/src/shared/config/crm-release.config.ts',
			{},
			{ env: { NODE_ENV: nodeEnv } }
		)
		assert.equal(release.getCrmAppUrl(), expected)
		assert.equal(release.CRM_RELEASE.apiEnabled, false)
		assert.equal(release.CRM_RELEASE.appUrl, 'https://crm.winwidget.ru')
	}
})

test('compact application switch preserves separate app navigation, keyboard closing and modified clicks', () => {
	for (const zone of ['widgets', 'admin-panel']) {
		let focused = false
		const details = {
			open: true,
			querySelector: selector => {
				assert.equal(selector, 'summary')
				return {
					focus: () => {
						focused = true
					}
				}
			}
		}
		const notifications = []
		let closed = 0
		const ProductSwitch = compile(
			'packages/winwidget-web/src/app/_ui/layout/nav-menu/product-switch/ProductSwitch.tsx',
			{
				react: { useRef: () => ({ current: details }) },
				'react/jsx-runtime': jsxRuntime,
				'react-hot-toast': (...args) => notifications.push(args),
				'@/shared/config/pages/public.config': compile(
					'packages/winwidget-web/src/shared/config/pages/public.config.ts'
				),
				'@/shared/config/crm-release.config': {
					getCrmAppUrl: () => 'https://crm.winwidget.ru'
				},
				'@/shared/lib/navigation/frontend-zones': {
					currentFrontendZone: () => zone
				},
				'@/shared/lib/navigation/ZoneLink': linkForZone(zone),
				'@/shared/ui/icons/AppIcon': () => null,
				'./ProductSwitch.module.scss': {}
			}
		).default
		const view = ProductSwitch({
			onNavigate: () => {
				closed++
			}
		})
		assert.equal(view.type, 'details')
		const [summary, nav] = view.props.children
		assert.equal(summary.type, 'summary')
		assert.equal(
			summary.props.children[1].props.children,
			zone === 'widgets' ? 'WinWidget' : 'Приложения'
		)
		assert.equal(nav.props['aria-label'], 'Рабочие приложения')
		const links = nav.props.children[1]
		assert.deepEqual(
			links.map(link => link.props.href),
			['/cabinet', 'https://crm.winwidget.ru']
		)
		assert.equal(
			links[0].props['aria-current'],
			zone === 'widgets' ? 'true' : undefined
		)
		assert.equal(links[1].props['aria-current'], undefined)
		assert.equal(linkForZone(zone)(links[1].props, null).type, 'a')
		assert.equal(
			linkForZone(zone)(links[0].props, null).type,
			zone === 'widgets' ? NextLink : 'a'
		)
		for (const mutation of [
			{ metaKey: true },
			{ ctrlKey: true },
			{ shiftKey: true },
			{ altKey: true },
			{ button: 1 },
			{ defaultPrevented: true }
		]) {
			links[1].props.onClick({ button: 0, ...mutation })
			assert.equal(details.open, true)
		}
		assert.equal(closed, 0)
		assert.deepEqual(notifications, [])
		links[1].props.onClick({ button: 0 })
		assert.equal(details.open, false)
		assert.equal(closed, 1)
		assert.deepEqual(notifications, [
			['Переход в WinCRM', { id: 'product-navigation' }]
		])
		details.open = true
		summary.props.onKeyDown({ key: 'Tab' })
		assert.equal(details.open, true)
		links[1].props.onKeyDown({ key: 'Escape' })
		assert.equal(details.open, false)
		assert.equal(focused, true)
		details.open = true
		details.contains = target => target === 'inside'
		view.props.onBlur({ currentTarget: details, relatedTarget: 'inside' })
		assert.equal(details.open, true)
		view.props.onBlur({ currentTarget: details, relatedTarget: null })
		assert.equal(details.open, false)
	}
})

test('desktop and mobile auth menus preserve existing cabinet, payment, admin and logout access', () => {
	for (const platform of ['desktop', 'mobile']) {
		for (const auth of [false, true]) {
			for (const isAdmin of [false, true]) {
				const user = { isAdmin: auth && isAdmin }
				const state = { auth, isAuthResolved: true }
				const prefix = `@/app/_ui/layout/nav-menu/${platform}/menu/`
				const LogoutButton = () => null
				const AuthItems = compile(
					`packages/winwidget-web/src/app/_ui/layout/nav-menu/${platform}/menu/auth-items/AuthItems.tsx`,
					{
						'react/jsx-runtime': jsxRuntime,
						[`${prefix}logout-button/LogoutButton`]: LogoutButton,
						[`${prefix}menu-item/MenuItem`]: () => null,
						'@/shared/config/pages/admin.config': {
							ADMIN_PAGES: { HOME: '/admin' }
						},
						'@/shared/config/pages/public.config': compile(
							'packages/winwidget-web/src/shared/config/pages/public.config.ts'
						),
						'@/entities/user': {
							useUser: () => ({ user, isLoading: false }),
							useAuthStore: selector => selector(state)
						}
					}
				).default
				const children = AuthItems().props.children.filter(Boolean)
				assert.deepEqual(
					children
						.filter(child => child.props.item)
						.map(child => child.props.item.link),
					auth
						? ['/cabinet', '/payment', ...(isAdmin ? ['/admin'] : [])]
						: ['/login', '/register']
				)
				assert.equal(
					children.some(child => child.type === LogoutButton),
					auth
				)
				if (!auth) assert.equal(children[0].props.item.title, 'Войти')
				state.isAuthResolved = false
				assert.equal(AuthItems(), null)
			}
		}
	}
})

test('desktop and mobile CRM links open the CRM domain before backend release', () => {
	const menuRoot = 'packages/winwidget-web/src/app/_ui/layout/nav-menu/'
	const release = compile(
		'packages/winwidget-web/src/shared/config/crm-release.config.ts'
	)
	assert.equal(release.CRM_RELEASE.apiEnabled, false)
	const { staticMenu } = compile(`${menuRoot}data/menu.data.ts`, {
		'@/shared/config/pages/public.config': compile(
			'packages/winwidget-web/src/shared/config/pages/public.config.ts'
		),
		'@/shared/config/crm-release.config': release
	})
	const crm = staticMenu.items.find(item => item.title === 'CRM')
	assert.ok(crm)
	assert.equal(crm.link, 'https://crm.winwidget.ru')
	assert.equal(crm.disabled, undefined)
	assert.equal(crm.tooltip, undefined)
	for (const platform of ['desktop', 'mobile']) {
		const closed = []
		const notifications = []
		const modulePath = `${menuRoot}${platform}/menu/menu-item/MenuItem`
		const MenuItem = compile(`${modulePath}.tsx`, {
			[`@/app/_ui/layout/nav-menu/${platform}/menu/menu-item/MenuItem.module.scss`]:
				{},
			'@/shared/ui/icons/AppIcon': () => null,
			clsx: require('clsx'),
			'react/jsx-runtime': jsxRuntime,
			'@/shared/lib/navigation/ZoneLink': linkForZone('landing'),
			'next/navigation': { usePathname: () => '/' },
			'react-hot-toast': message => notifications.push(message),
			'@/features/mobile-navigation': {
				useHamburgerStore: selector =>
					selector({
						setVisible: visible => closed.push(['menu', visible])
					})
			},
			'@/shared/lib/veil-background': {
				useVeilBackgroundStore: selector =>
					selector({
						setVisible: visible => closed.push(['veil', visible])
					})
			}
		}).default
		const item = MenuItem({ item: crm })
		const link = item.props.children
		assert.equal(link.props.href, crm.link)
		assert.equal(link.props['aria-disabled'], undefined)
		assert.equal(link.props.title, undefined)
		assert.equal(link.props.children.filter(Boolean).length, 2)
		let prevented = false
		link.props.onClick({ preventDefault: () => (prevented = true) })
		assert.equal(prevented, false)
		assert.deepEqual(notifications, [])
		assert.deepEqual(
			closed,
			platform === 'mobile'
				? [
						['menu', false],
						['veil', false]
					]
				: []
		)
		for (const zone of zoneNames) {
			const anchor = linkForZone(zone)(link.props, null)
			assert.equal(anchor.type, 'a')
			assert.equal(anchor.props.href, crm.link)
			assert.equal(Object.hasOwn(anchor.props, 'prefetch'), false)
		}
	}
})

test('relative, absolute, external and protocol-relative URLs use document resolution', () => {
	for (const zone of zoneNames) {
		for (const href of [
			'cabinet',
			'../admin?filter=1#row',
			'',
			'https://winwidget.ru/cabinet',
			'https://crm.winwidget.ru/inbox',
			'https://external.example/admin',
			'//external.example/cabinet',
			'mailto:hello@example.test',
			'tel:+70000000000'
		]) {
			assert.equal(zones.needsDocumentNavigation(href, zone), true, href)
		}
	}
})

test('URL authority normalization cannot turn an external URL into a local prefetch', () => {
	for (const zone of zoneNames) {
		for (const route of ['/cabinet', '/admin', '/']) {
			assert.equal(
				zones.needsDocumentNavigation(`/\\external.example${route}`, zone),
				true
			)
		}
	}
})

test('normalized dot segments choose the actual destination zone', () => {
	assert.equal(
		zones.needsDocumentNavigation(
			'/admin/../cabinet?tab=1#row',
			'admin-panel'
		),
		true
	)
	assert.equal(
		zones.needsDocumentNavigation(
			'/admin/../cabinet?tab=1#row',
			'widgets'
		),
		false
	)
	assert.equal(
		zones.needsDocumentNavigation('/cabinet/../admin', 'widgets'),
		true
	)
})

test('same-zone Link keeps Next semantics and all caller-controlled props/ref', () => {
	const Link = linkForZone('widgets')
	const ref = { current: null }
	const onClick = event => event.preventDefault()
	const props = {
		href: '/cabinet?tab=widgets#one',
		children: 'Open',
		className: 'link',
		target: '_blank',
		rel: 'noopener',
		title: 'Cabinet',
		onClick,
		'aria-disabled': true,
		prefetch: false,
		replace: true,
		scroll: false
	}
	const element = Link(props, ref)
	assert.equal(element.type, NextLink)
	assert.deepEqual(element.props, { ...props, ref })
})

test('cross-zone Link is a native anchor preserving query/hash, actions and accessibility', () => {
	const Link = linkForZone('widgets')
	const ref = { current: null }
	let prevented = false
	const onClick = event => event.preventDefault()
	const props = {
		href: '/admin/crm?tab=pricing#form',
		children: 'Admin',
		className: 'link',
		target: '_blank',
		rel: 'noopener noreferrer',
		onClick,
		'aria-label': 'Open administration',
		'data-testid': 'admin-link',
		download: false
	}
	const element = Link(
		{
			...props,
			replace: true,
			scroll: false,
			shallow: false,
			prefetch: true,
			locale: false,
			legacyBehavior: false,
			passHref: true
		},
		ref
	)
	assert.equal(element.type, 'a')
	assert.deepEqual(element.props, { ...props, ref })
	element.props.onClick({
		preventDefault: () => {
			prevented = true
		}
	})
	assert.equal(prevented, true)
})

test('external Link never renders NextLink, even when prefetch was requested', () => {
	for (const href of [
		'https://external.example/admin',
		'//external.example/admin',
		'https://crm.winwidget.ru/inbox',
		'/\\external.example/cabinet'
	]) {
		const element = linkForZone('widgets')(
			{ href, prefetch: true, children: 'Open' },
			null
		)
		assert.equal(element.type, 'a', href)
		assert.equal(element.props.href, href)
		assert.equal(Object.hasOwn(element.props, 'prefetch'), false)
	}
})

test('same-zone push/replace/prefetch preserve Next options and history helpers', () => {
	const { router, calls, nextRouter } = routerForZone('widgets')
	const options = { scroll: false }
	const prefetchOptions = { kind: 'auto' }
	router.push('/cabinet?tab=payments#recent', options)
	router.replace('/payment?retry=1#status', options)
	router.prefetch('/login?returnUrl=%2Fadmin', prefetchOptions)
	assert.deepEqual(calls, [
		['next', 'push', '/cabinet?tab=payments#recent', options],
		['next', 'replace', '/payment?retry=1#status', options],
		['next', 'prefetch', '/login?returnUrl=%2Fadmin', prefetchOptions]
	])
	for (const name of ['back', 'forward', 'refresh'])
		assert.equal(router[name], nextRouter[name])
})

test('cross-zone and external routers hard navigate without leaking an RSC prefetch', () => {
	for (const href of [
		'/admin/crm?tab=tariff#form',
		'/?utm_source=widgets#pricing',
		'https://crm.winwidget.ru/inbox',
		'//external.example/cabinet',
		'/\\external.example/cabinet'
	]) {
		const { router, calls } = routerForZone('widgets')
		router.push(href, { scroll: false })
		router.replace(href, { scroll: false })
		router.prefetch(href)
		assert.deepEqual(calls, [
			['document', 'assign', href],
			['document', 'replace', href]
		])
	}
})

test('admin root and its platform providers exclude arbitrary homepage HTML and affiliate tracking', () => {
	for (const relative of [
		'apps/admin-panel/src/app/layout.tsx',
		'apps/admin-panel/src/app/_ui/AdminFrame.tsx',
		'packages/winwidget-web/src/app/providers/PlatformProviders.tsx'
	]) {
		const text = read(relative)
		assert.doesNotMatch(
			text,
			/dangerouslySetInnerHTML|AffiliateReferralTracker|affiliateReferrerId|getHomePageContent|CookieConsentProvider/
		)
		assert.doesNotMatch(
			text,
			/from ['"]@\/app\/providers\/AppProviders['"]/
		)
		assert.doesNotMatch(text, /from ['"]@\/app\/_ui\/layout\/Layout['"]/)
	}
	assert.match(
		read('apps/admin-panel/src/app/layout.tsx'),
		/<PlatformProviders hasSessionHint=\{hasSessionHint\}>/
	)
	assert.match(
		read('packages/winwidget-web/src/app/providers/PlatformProviders.tsx'),
		/<SessionProvider hasSessionHint=\{hasSessionHint\}>/
	)
	assert.match(
		read('packages/winwidget-web/src/app/providers/AppProviders.tsx'),
		/<AffiliateReferralTracker\s*\/>/
	)
	assert.match(
		read('apps/landing/src/app/layout.tsx'),
		/dangerouslySetInnerHTML/
	)
})

test('verified ADMIN still reaches the admin application without a DEV-only root gate', async () => {
	const request = { url: 'https://winwidget.ru/admin/crm' }
	const next = { kind: 'next' }
	let user = { isLoggedIn: true, isAdmin: true }
	const { adminMiddleware } = compile(
		'packages/winwidget-web/src/app/middlewares/adminMiddleware.ts',
		{
			'next/server': {
				NextResponse: {
					next: () => next,
					redirect: url => ({ kind: 'redirect', url: url.href })
				}
			},
			'@/features/auth/server/refresh-middleware-token': {
				getAuthWithRefresh: async () => ({ user }),
				copySetCookieHeaders: () => {}
			}
		}
	)
	assert.equal(await adminMiddleware(request), next)
	user = { isLoggedIn: true, isAdmin: false }
	assert.equal(
		(await adminMiddleware(request)).url,
		'https://winwidget.ru/cabinet'
	)
	user = null
	assert.equal(
		(await adminMiddleware(request)).url,
		'https://winwidget.ru/login'
	)
	assert.match(
		read('apps/admin-panel/src/middleware.ts'),
		/matcher: \['\/admin\/:path\*'\]/
	)
})
