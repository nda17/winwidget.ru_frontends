import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
const repositoryRoot = path.resolve(sourceRoot, '../../..')
const sharedRoot = path.join(repositoryRoot, 'packages/winwidget-web/src')
const nativeRequire = createRequire(
	path.join(repositoryRoot, 'apps/landing/package.json')
)
const React = nativeRequire('react')
const { renderToStaticMarkup } = nativeRequire('react-dom/server')

// Execute the actual React 18 components and pure TS contracts. The only
// doubles are framework navigation/effects and the explicit server data ports.
function loader({ overrides = {}, effect = () => {} } = {}) {
	const cache = new Map()
	const calls = { toasts: [] }
	const mockReact = { ...React, useEffect: effect }
	const mocks = {
		react: mockReact,
		'react/jsx-runtime': nativeRequire('react/jsx-runtime'),
		'react-hot-toast': message => calls.toasts.push(message),
		'@/shared/lib/navigation/ZoneLink': props =>
			React.createElement('a', props),
		...overrides
	}
	function readModule(filename) {
		if (cache.has(filename)) return cache.get(filename).exports
		if (filename.endsWith('.scss')) {
			return new Proxy(
				{},
				{
					get: (_target, key) =>
						key === '__esModule' ? false : String(key)
				}
			)
		}
		const source = readFileSync(filename, 'utf8')
		const compiled = ts.transpileModule(source, {
			fileName: filename,
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				target: ts.ScriptTarget.ES2022,
				jsx: ts.JsxEmit.ReactJSX,
				esModuleInterop: true
			}
		}).outputText
		const compiledModule = { exports: {} }
		cache.set(filename, compiledModule)
		const resolve = specifier => {
			if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
			const roots = specifier.startsWith('@/')
				? [sourceRoot, sharedRoot].map(root =>
						path.join(root, specifier.slice(2))
					)
				: specifier.startsWith('.')
					? [path.resolve(path.dirname(filename), specifier)]
					: []
			for (const base of roots) {
				for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
					const candidate = `${base}${suffix}`
					if (existsSync(candidate) && /\.(?:tsx?|scss)$/.test(candidate))
						return readModule(candidate)
				}
			}
			throw new Error(`Unexpected test dependency: ${specifier}`)
		}
		new Function('require', 'module', 'exports', compiled)(
			resolve,
			compiledModule,
			compiledModule.exports
		)
		return compiledModule.exports
	}
	return {
		load: relative => readModule(path.join(sourceRoot, relative)),
		calls
	}
}

const editorial = loader().load(
	'../../../packages/winwidget-web/src/entities/home-page-content/model/product-marketing.defaults.ts'
)
const ecosystemContent = () =>
	structuredClone(editorial.DEFAULT_ECOSYSTEM_CONTENT)
const crmContent = () =>
	structuredClone(editorial.DEFAULT_CRM_PRODUCT_CONTENT)
const render = element => renderToStaticMarkup(element)

test('legacy Widgets anchors preserve the exact query and hash on root only', () => {
	const { legacyWidgetLink } = loader().load(
		'screens/ecosystem/lib/legacy-widget-link.ts'
	)
	for (const hash of ['#tools', '#pricing', '#faq']) {
		assert.equal(
			legacyWidgetLink('/', '?utm_source=email&next=%2Fcabinet', hash),
			`/products/widgets?utm_source=email&next=%2Fcabinet${hash}`
		)
		assert.equal(
			legacyWidgetLink('/', '', hash),
			`/products/widgets${hash}`
		)
	}
	for (const hash of [
		'',
		'#products',
		'#plans',
		'#help',
		'#Pricing',
		'#pricing/evil',
		'#%70ricing',
		'#//evil.test',
		'#hero-title'
	]) {
		assert.equal(legacyWidgetLink('/', '', hash), null)
	}
	for (const pathname of [
		'/products/widgets',
		'/products/crm',
		'/login',
		'//evil.test'
	]) {
		assert.equal(legacyWidgetLink(pathname, '', '#pricing'), null)
	}
})

test('legacy bridge handles initial and later anchors and removes its own listener', () => {
	let initialize
	let listener
	let removed
	const replacements = []
	const previous = globalThis.window
	globalThis.window = {
		location: {
			pathname: '/',
			search: '?campaign=old',
			hash: '#pricing',
			replace: value => replacements.push(value)
		},
		addEventListener: (name, callback) => {
			assert.equal(name, 'hashchange')
			listener = callback
		},
		removeEventListener: (name, callback) => {
			removed = [name, callback]
		}
	}
	try {
		const { LegacyWidgetAnchors } = loader({
			effect: callback => {
				initialize = callback
			}
		}).load('screens/ecosystem/ui/LegacyWidgetAnchors.tsx')
		assert.equal(LegacyWidgetAnchors(), null)
		const cleanup = initialize()
		assert.deepEqual(replacements, [
			'/products/widgets?campaign=old#pricing'
		])
		globalThis.window.location.hash = '#plans'
		listener()
		assert.equal(replacements.length, 1)
		globalThis.window.location.hash = '#faq'
		listener()
		assert.equal(replacements[1], '/products/widgets?campaign=old#faq')
		cleanup()
		assert.deepEqual(removed, ['hashchange', listener])
	} finally {
		if (previous === undefined) delete globalThis.window
		else globalThis.window = previous
	}
})

test('three public pages receive independent editable SEO and exact canonical URLs', () => {
	const { productMetadata } = loader().load('app/_lib/product-metadata.ts')
	for (const [pathname, title] of [
		['/', 'Ecosystem'],
		['/products/widgets', 'Widgets'],
		['/products/crm', 'WinCRM']
	]) {
		const seo = {
			title,
			description: `${title} description`,
			keywords: [title],
			ogTitle: `${title} OG`,
			ogDescription: 'OG description'
		}
		const value = productMetadata(seo, pathname)
		const url = `https://winwidget.ru${pathname === '/' ? '' : pathname}`
		assert.deepEqual(value.title, { absolute: title })
		assert.equal(value.description, seo.description)
		assert.equal(value.openGraph.title, seo.ogTitle)
		assert.equal(value.openGraph.url, url)
		assert.equal(value.alternates.canonical, url)
	}
})

test('sitemap executes the explicit disabled state instead of resurrecting default public URLs', async () => {
	const original = [
		{ path: '/', changeFrequency: 'weekly', priority: 1, enabled: true },
		{
			path: '/products/widgets',
			changeFrequency: 'weekly',
			priority: 0.9,
			enabled: true
		},
		{
			path: '/products/crm',
			changeFrequency: 'weekly',
			priority: 0.9,
			enabled: true
		}
	]
	const disabled = original.map(item => ({ ...item, enabled: false }))
	const defaults = {
		baseUrl: 'https://winwidget.ru',
		sitemapItems: original
	}
	const content = {
		technicalSeo: {
			baseUrl: 'https://winwidget.ru',
			sitemapItems: disabled
		}
	}
	const { default: sitemap } = loader({
		overrides: {
			'@/entities/home-page-content': {
				DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT: defaults
			},
			'@/entities/home-page-content/server': {
				getHomePageContent: async () => content
			}
		}
	}).load('app/sitemap.ts')
	assert.deepEqual(await sitemap(), [])
	content.technicalSeo.sitemapItems = [
		disabled[0],
		original[1],
		disabled[2]
	]
	assert.deepEqual(
		(await sitemap()).map(item => item.url),
		['https://winwidget.ru/products/widgets']
	)
	content.technicalSeo.sitemapItems = original
	assert.deepEqual(
		(await sitemap()).map(item => item.url),
		[
			'https://winwidget.ru',
			'https://winwidget.ru/products/widgets',
			'https://winwidget.ru/products/crm'
		]
	)
})

test('ecosystem SSR contains exactly two independent product cards and the new anchor IDs', () => {
	const { Ecosystem } = loader().load('screens/ecosystem/ui/Ecosystem.tsx')
	const html = render(
		React.createElement(Ecosystem, { content: ecosystemContent() })
	)
	assert.equal((html.match(/<h1 /g) ?? []).length, 1)
	for (const id of ['products', 'plans', 'help'])
		assert.equal(
			(html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length,
			1
		)
	for (const id of ['tools', 'pricing', 'faq'])
		assert.doesNotMatch(html, new RegExp(`id="${id}"`))
	assert.equal(
		(html.match(/class="productCard(?: crmCard)?\s*"/g) ?? []).length,
		2
	)
	assert.match(html, /href="\/products\/widgets#pricing"/)
	assert.match(html, /href="\/products\/crm"/)
	assert.match(html, /Widgets<\/h3>/)
	assert.match(html, /WinCRM<\/h3>/)
	assert.match(html, /Скоро/)
	assert.doesNotMatch(html, /href="\/(?:payment|register|crm\/access)/)
})

test('optional editorial sections can be hidden without removing either product', () => {
	const content = ecosystemContent()
	for (const section of ['integration', 'plans', 'faq', 'cta'])
		content[section].enabled = false
	const { Ecosystem } = loader().load('screens/ecosystem/ui/Ecosystem.tsx')
	const html = render(React.createElement(Ecosystem, { content }))
	assert.match(html, /id="products"/)
	assert.doesNotMatch(html, /id="(?:plans|help)"|<details/)
	assert.match(html, /href="\/products\/widgets"/)
	assert.match(html, /href="\/products\/crm"/)
})

test('editorial HTML is escaped and cannot set product URLs, identities, or release status', () => {
	const content = ecosystemContent()
	content.hero.title = '<script>alert("editorial")</script>'
	content.products.crm = {
		...content.products.crm,
		href: 'https://evil.test',
		title: 'Other product',
		apiEnabled: true
	}
	content.faq.items = [
		{
			question: '<img src=x>',
			answer: '<iframe src="https://evil.test"></iframe>'
		}
	]
	const { Ecosystem } = loader().load('screens/ecosystem/ui/Ecosystem.tsx')
	const html = render(React.createElement(Ecosystem, { content }))
	assert.doesNotMatch(
		html,
		/<script|<img|<iframe|href="https:\/\/evil\.test"|Other product/
	)
	assert.match(html, /&lt;script&gt;/)
	assert.match(html, /&lt;iframe/)
	assert.match(html, /WinCRM<\/h3>/)
	assert.match(html, /Скоро/)
})

test('CRM marketing keeps Soon and navigates without starting Trial, checkout, or session', () => {
	const { CrmProduct } = loader().load(
		'screens/crm-product/ui/CrmProduct.tsx'
	)
	const html = render(
		React.createElement(CrmProduct, { content: crmContent() })
	)
	assert.equal((html.match(/<h1 /g) ?? []).length, 1)
	assert.equal(
		(html.match(/href="https:\/\/crm\.winwidget\.ru"/g) ?? []).length,
		2
	)
	assert.match(html, /Скоро/)
	assert.doesNotMatch(
		html,
		/<form|href="[^\"]*(?:checkout|activate|payment|register)/
	)
	for (const section of [
		'features',
		'workflow',
		'integration',
		'faq',
		'cta'
	]) {
		const content = crmContent()
		content[section].enabled = false
		const reduced = render(React.createElement(CrmProduct, { content }))
		assert.ok(!reduced.includes(content[section].title))
	}
})

test('marketing routes request only editorial content; Widgets preserves its three server inputs', async () => {
	const content = {
		ecosystem: ecosystemContent(),
		crmProduct: crmContent(),
		seo: { title: 'Legacy Widgets' }
	}
	const calls = []
	const tariffs = [{ plan: 'EASY', fixture: true }]
	const affiliate = { enabled: true, cashbackPercent: 15 }
	const source = loader({
		overrides: {
			'@/entities/home-page-content/server': {
				getHomePageContent: async () => {
					calls.push('content')
					return content
				}
			},
			'@/entities/subscription/server': {
				getTariffPrices: async () => {
					calls.push('tariffs')
					return tariffs
				}
			},
			'@/entities/affiliate/server': {
				getAffiliatePublicSettings: async () => {
					calls.push('affiliate')
					return affiliate
				}
			},
			'@/screens/home': {
				Home: props =>
					React.createElement(
						'div',
						{ 'data-original-home': true },
						String(
							props.tariffPrices === tariffs &&
								props.affiliateSettings === affiliate &&
								props.content === content
						)
					)
			}
		}
	})
	for (const route of ['app/page.tsx', 'app/products/crm/page.tsx']) {
		calls.length = 0
		await source.load(route).default()
		assert.deepEqual(calls, ['content'])
	}
	calls.length = 0
	const widgetsPage = await source
		.load('app/products/widgets/page.tsx')
		.default()
	assert.deepEqual(calls.sort(), ['affiliate', 'content', 'tariffs'])
	assert.match(render(widgetsPage), /data-original-home="true">true/)
})

test('CRM CTA stays inside the local development stand, while production uses its fixed public origin', () => {
	const previousMode = process.env.NODE_ENV
	try {
		for (const [mode, origin] of [
			['development', 'http://localhost:3001'],
			['production', 'https://crm.winwidget.ru']
		]) {
			process.env.NODE_ENV = mode
			const { CrmProduct } = loader().load(
				'screens/crm-product/ui/CrmProduct.tsx'
			)
			const html = render(
				React.createElement(CrmProduct, { content: crmContent() })
			)
			assert.equal(html.split(`href="${origin}"`).length - 1, 2)
			assert.match(html, /Скоро/)
		}
	} finally {
		if (previousMode === undefined) delete process.env.NODE_ENV
		else process.env.NODE_ENV = previousMode
	}
})

test('CTA action notification does not intercept navigation or modified clicks', () => {
	const source = loader()
	const { MarketingLink } = source.load(
		'shared/ui/product-marketing/ui/MarketingLink.tsx'
	)
	const element = MarketingLink({
		href: '/products/widgets',
		children: 'Open'
	})
	let intercepted = false
	const event = {
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		preventDefault: () => {
			intercepted = true
		}
	}
	element.props.onClick(event)
	assert.equal(source.calls.toasts.length, 1)
	for (const override of [
		{ button: 1 },
		{ metaKey: true },
		{ ctrlKey: true },
		{ shiftKey: true },
		{ altKey: true }
	])
		element.props.onClick({ ...event, ...override })
	assert.equal(source.calls.toasts.length, 1)
	assert.equal(intercepted, false)
})

test('FAQ uses keyboard-native disclosure, plain text, and action notifications', () => {
	const source = loader()
	const { MarketingFaq } = source.load(
		'shared/ui/product-marketing/ui/MarketingFaq.tsx'
	)
	const element = MarketingFaq({
		title: 'FAQ',
		items: [{ question: 'Question', answer: '<b>Plain text</b>' }]
	})
	const html = render(element)
	assert.match(html, /<details[^>]*><summary>/)
	assert.match(html, /&lt;b&gt;Plain text&lt;\/b&gt;/)
	const disclosure = element.props.children[1].props.children[0]
	disclosure.props.onToggle({ currentTarget: { open: true } })
	disclosure.props.onToggle({ currentTarget: { open: false } })
	assert.deepEqual(source.calls.toasts, ['Ответ открыт', 'Ответ скрыт'])
})

test('new screens do not import another app or introduce product API/persistence calls', () => {
	for (const relative of [
		'screens/ecosystem/ui/Ecosystem.tsx',
		'screens/crm-product/ui/CrmProduct.tsx',
		'shared/ui/product-marketing/ui/ProductMarketing.tsx',
		'shared/ui/product-marketing/ui/MarketingLink.tsx',
		'shared/ui/product-marketing/ui/MarketingFaq.tsx'
	]) {
		const source = readFileSync(path.join(sourceRoot, relative), 'utf8')
		assert.doesNotMatch(
			source,
			/\b(?:fetch|axios|useQuery|localStorage|sessionStorage)\b|apps\/(?:crm|widgets)|dangerouslySetInnerHTML/
		)
	}
})

test('marketing styling is local, responsive, reduced-motion aware and leaves no unused class', () => {
	const directory = path.join(sourceRoot, 'shared/ui/product-marketing/ui')
	const scss = readFileSync(
		path.join(directory, 'ProductMarketing.module.scss'),
		'utf8'
	)
	const components = [
		'ProductMarketing.tsx',
		'MarketingLink.tsx',
		'MarketingFaq.tsx'
	]
		.map(filename => readFileSync(path.join(directory, filename), 'utf8'))
		.join('\n')
	assert.match(scss, /@apply[^;]*grid-cols-1[^;]*md:grid-cols-2/)
	assert.match(scss, /prefers-reduced-motion/)
	assert.match(scss, /focus-visible:outline/)
	assert.doesNotMatch(
		scss,
		/\b(?:width|height|display|padding|margin|color|background):/
	)
	for (const match of scss.matchAll(/^\.([a-zA-Z][\w-]*)/gm))
		assert.ok(
			components.includes(`styles.${match[1]}`),
			`Unused style ${match[1]}`
		)
})
