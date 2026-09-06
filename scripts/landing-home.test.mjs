import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import autoprefixer from 'autoprefixer'
import postcss from 'postcss'
import * as sass from 'sass'
import tailwindcss from 'tailwindcss'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))

const require = createRequire(
	new URL('../apps/landing/package.json', import.meta.url)
)
const React = require('react')
const read = relative =>
	readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
const compile = (relative, dependencies = {}) => {
	const module = { exports: {} }
	const compiled = ts.transpileModule(read(relative), {
		fileName: relative,
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			jsx: ts.JsxEmit.ReactJSX,
			esModuleInterop: true
		}
	}).outputText
	new Function('exports', 'module', 'require', compiled)(
		module.exports,
		module,
		name => {
			if (name === 'react/jsx-runtime') return require(name)
			assert.ok(
				Object.hasOwn(dependencies, name),
				`Unexpected dependency: ${name}`
			)
			return dependencies[name]
		}
	)
	return module.exports
}

const pagePath = 'apps/landing/src/app/page.tsx'
const Home = () => null
const content = {
	hero: { title: 'Сохранённый лендинг виджетов' },
	seo: {
		title: 'Widgets CMS title',
		description: 'Widgets CMS description',
		keywords: 'widgets, leads',
		ogTitle: 'Widgets OG title',
		ogDescription: 'Widgets OG description'
	},
	ecosystem: { seo: { title: 'Withdrawn ecosystem SEO' } }
}
const page = (
	getContent = async () => content,
	prices = null,
	affiliate = null
) =>
	compile(pagePath, {
		'@/screens/home': { Home },
		'@/entities/home-page-content/server': {
			getHomePageContent: getContent
		},
		'@/entities/subscription/server': {
			getTariffPrices: async () => prices
		},
		'@/entities/affiliate/server': {
			getAffiliatePublicSettings: async () => affiliate
		}
	})

test('root renders the original Home with CMS data, live tariff prices and affiliate settings', async () => {
	const prices = [{ plan: 'EASY', monthly: 1234 }]
	const affiliate = { enabled: true, cashbackPercent: 12 }
	const element = await page(undefined, prices, affiliate).default()
	assert.equal(React.isValidElement(element), true)
	assert.equal(element.type, Home)
	assert.deepEqual(element.props, {
		content,
		tariffPrices: prices,
		affiliateSettings: affiliate
	})
})

test('root preserves the existing unavailable pricing/affiliate fallback', async () => {
	const element = await page().default()
	assert.equal(element.type, Home)
	assert.equal(element.props.tariffPrices, null)
	assert.equal(element.props.affiliateSettings, null)
})

test('root SEO uses editable widget fields and the original canonical URL', async () => {
	const metadata = await page().generateMetadata()
	assert.equal(metadata.title, content.seo.title)
	assert.equal(metadata.description, content.seo.description)
	assert.equal(metadata.keywords, content.seo.keywords)
	assert.equal(metadata.openGraph.title, content.seo.ogTitle)
	assert.equal(metadata.openGraph.description, content.seo.ogDescription)
	assert.equal(metadata.openGraph.url, 'https://winwidget.ru')
	assert.equal(metadata.alternates.canonical, 'https://winwidget.ru')
	assert.equal(metadata.openGraph.images[0].url, '/og-image.png')
})

test('the original root sections and direct anchors remain without a redirect bridge', () => {
	const home = read('apps/landing/src/screens/home/ui/Home.tsx')
	for (const section of [
		'HeroSection',
		'HomeTools',
		'HomePricing',
		'HomeFaq',
		'LazyDemoWidgets'
	]) {
		assert.match(home, new RegExp(`<${section}\\b`))
	}
	for (const [directory, component, id] of [
		['tools', 'HomeTools', 'tools'],
		['pricing', 'HomePricing', 'pricing'],
		['faq', 'HomeFaq', 'faq']
	]) {
		assert.match(
			read(
				`apps/landing/src/screens/home/ui/${directory}/${component}.tsx`
			),
			new RegExp(`id="${id}"`)
		)
	}
	assert.doesNotMatch(
		read(pagePath),
		/Ecosystem|redirect|LegacyWidgetAnchors|products\//
	)
	for (const relative of [
		'app/products/widgets/page.tsx',
		'app/products/crm/page.tsx',
		'screens/ecosystem/ui/LegacyWidgetAnchors.tsx'
	]) {
		assert.equal(
			existsSync(
				new URL(`../apps/landing/src/${relative}`, import.meta.url)
			),
			false
		)
	}
})

const sitemap = items =>
	compile('apps/landing/src/app/sitemap.ts', {
		'@/entities/home-page-content': {
			DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT: {
				baseUrl: 'https://winwidget.ru'
			}
		},
		'@/entities/home-page-content/server': {
			getHomePageContent: async () => ({
				technicalSeo: {
					baseUrl: 'https://winwidget.ru/',
					sitemapItems: items
				}
			})
		}
	}).default()
const entry = (path, enabled = true) => ({
	path,
	enabled,
	changeFrequency: 'weekly',
	priority: 0.5
})

test('sitemap omits withdrawn pages even in persisted CMS data without mutating those entries', async () => {
	const items = [
		'/',
		'/products/widgets',
		'/products/widgets/',
		'/products/crm',
		'/products/crm/',
		'/custom'
	].map(path => entry(path))
	items.push(entry('/disabled', false))
	const before = structuredClone(items)
	assert.deepEqual(
		(await sitemap(items)).map(item => item.url),
		['https://winwidget.ru', 'https://winwidget.ru/custom']
	)
	assert.deepEqual(items, before)
})

test('sitemap respects explicitly empty or fully disabled configuration', async () => {
	assert.deepEqual(await sitemap([]), [])
	assert.deepEqual(
		await sitemap([entry('/', false), entry('/custom', false)]),
		[]
	)
})

// Use the actual app config, including its shared preset, through the same
// Sass -> Tailwind -> Autoprefixer pipeline as Next. Default Tailwind alone
// would miss the project's intentional legacy leading-5 = 5rem override.
async function compiledStyle(app, relative) {
	const filename = path.join(repositoryRoot, relative)
	const scss = readFileSync(filename, 'utf8')
	return (
		await postcss([
			tailwindcss(
				path.join(repositoryRoot, `apps/${app}/tailwind.config.ts`)
			),
			autoprefixer
		]).process(
			sass.compileString(
				`${scss}\n.legacyLeadingControl { @apply text-xs leading-5; }`
			).css,
			{ from: filename }
		)
	).root
}

function declarationsFor(root, selector) {
	const declarations = {}
	root.walkRules(rule => {
		if (rule.selectors.includes(selector))
			rule.walkDecls(declaration => {
				declarations[declaration.prop] = declaration.value
			})
	})
	assert.ok(Object.keys(declarations).length, `Missing CSS: ${selector}`)
	return declarations
}

function cssPixels(value) {
	assert.match(value, /^\d+(?:\.\d+)?(?:px|rem)$/)
	return Number.parseFloat(value) * (value.endsWith('rem') ? 16 : 1)
}

test('compiled product switch caption stays compact in all three shared-preset apps', async () => {
	for (const app of ['landing', 'widgets', 'admin-panel']) {
		const css = await compiledStyle(
			app,
			'packages/winwidget-web/src/app/_ui/layout/nav-menu/product-switch/ProductSwitch.module.scss'
		)
		assert.equal(
			declarationsFor(css, '.legacyLeadingControl')['line-height'],
			'5rem'
		)
		const caption = declarationsFor(css, '.caption')
		assert.equal(cssPixels(caption['font-size']), 12, app)
		assert.equal(cssPixels(caption['line-height']), 20, app)
		assert.equal(
			['line-height', 'padding-top', 'padding-bottom'].reduce(
				(sum, property) => sum + cssPixels(caption[property]),
				0
			),
			36,
			app
		)
	}
})

test('compiled existing CMS controls retain normal text metrics without changing the legacy scale', async () => {
	const css = await compiledStyle(
		'admin-panel',
		'apps/admin-panel/src/screens/admin/ui/content-settings/home-content-editor/HomeContentEditor.module.scss'
	)
	assert.equal(
		declarationsFor(css, '.legacyLeadingControl')['line-height'],
		'5rem'
	)
	for (const selector of ['.textarea', '.addBtn']) {
		const control = declarationsFor(css, selector)
		assert.equal(cssPixels(control['font-size']), 14, selector)
		assert.equal(cssPixels(control['line-height']), 20, selector)
	}
})
