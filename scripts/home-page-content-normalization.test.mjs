import { resolveWorkspaceSource } from './resolve-workspace-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const defaultsPath = resolveWorkspaceSource(
	'src/entities/home-page-content/model/home-page-content.defaults.ts'
)
const editorPath = resolveWorkspaceSource(
	'src/screens/admin/ui/content-settings/home-content-editor/HomeContentEditor.tsx'
)

const defaultsSource = await readFile(defaultsPath, 'utf8')
const editorSource = await readFile(editorPath, 'utf8')
const compiledDefaults = ts.transpileModule(defaultsSource, {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2022
	},
	fileName: defaultsPath.pathname
}).outputText
const defaultsModule = { exports: {} }
const marketingSource = await readFile(
	new URL('./product-marketing.defaults.ts', defaultsPath),
	'utf8'
)
const marketingModule = { exports: {} }
new Function(
	'exports',
	'module',
	ts.transpileModule(marketingSource, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022
		}
	}).outputText
)(marketingModule.exports, marketingModule)

new Function('exports', 'module', 'require', compiledDefaults)(
	defaultsModule.exports,
	defaultsModule,
	path => {
		assert.equal(path, './product-marketing.defaults')
		return marketingModule.exports
	}
)

const {
	DEFAULT_HOME_PAGE_CONTENT,
	normalizeHomePageContent,
	normalizeHomePageDemoWidgetsContent
} = defaultsModule.exports

const demoWidgetKeys = ['bubbleTexts', 'enabled']
const bubbleTextKeys = [
	'aiConsultant',
	'calculator',
	'callback',
	'countdown',
	'quiz',
	'stopOffer',
	'wheel'
]

test('legacy demo widget keys are removed from the normalized PATCH round trip', () => {
	const legacyContent = structuredClone(DEFAULT_HOME_PAGE_CONTENT)
	legacyContent.demoWidgets.labels = {
		wheel: 'Legacy wheel label'
	}
	legacyContent.demoWidgets.legacyMode = true
	legacyContent.demoWidgets.bubbleTexts.legacyBubble = 'Legacy bubble'
	legacyContent.tools.items[4].previewType = 'unsupportedPreview'

	const normalized = normalizeHomePageContent(legacyContent)
	const patchContent = {
		...normalized,
		demoWidgets: normalizeHomePageDemoWidgetsContent(
			normalized.demoWidgets
		)
	}
	const { head, body, ...structuredPatchContent } = patchContent
	void head
	void body

	assert.deepEqual(
		Object.keys(structuredPatchContent.demoWidgets).sort(),
		demoWidgetKeys
	)
	assert.deepEqual(
		Object.keys(structuredPatchContent.demoWidgets.bubbleTexts).sort(),
		bubbleTextKeys
	)
	assert.equal(
		structuredPatchContent.tools.items[4].previewType,
		'aiConsultant'
	)
	assert.deepEqual(
		normalizeHomePageContent(structuredPatchContent).demoWidgets,
		structuredPatchContent.demoWidgets
	)
})

test('current demo widgets payload remains unchanged after canonicalization', () => {
	const currentPayload = structuredClone(
		DEFAULT_HOME_PAGE_CONTENT.demoWidgets
	)

	assert.deepEqual(
		normalizeHomePageDemoWidgetsContent(currentPayload),
		currentPayload
	)
})

test('admin save preparation canonicalizes demo widgets at the PATCH boundary', () => {
	assert.match(
		editorSource,
		/demoWidgets:\s*normalizeHomePageDemoWidgetsContent\(content\.demoWidgets\)/
	)
})

test('legacy CMS payload keeps the compatible stored product fields without changing Widgets', () => {
	const old = structuredClone(DEFAULT_HOME_PAGE_CONTENT)
	delete old.ecosystem
	delete old.crmProduct
	old.hero.subtitle = 'Existing Widgets copy'
	const result = normalizeHomePageContent(old)
	assert.deepEqual(result.ecosystem, DEFAULT_HOME_PAGE_CONTENT.ecosystem)
	assert.deepEqual(result.crmProduct, DEFAULT_HOME_PAGE_CONTENT.crmProduct)
	assert.equal(result.hero.subtitle, old.hero.subtitle)
	result.ecosystem.hero.title = 'Edited'
	assert.notEqual(DEFAULT_HOME_PAGE_CONTENT.ecosystem.hero.title, 'Edited')
})

test('marketing normalization preserves deliberate empty and disabled values, bounds types and ignores unknown controls', () => {
	const result = normalizeHomePageContent({
		ecosystem: {
			hero: { title: '', subtitle: { html: 'invalid' } },
			plans: { enabled: false },
			faq: { items: [] },
			appUrl: 'https://invalid.test'
		},
		crmProduct: {
			hero: { title: 'x'.repeat(501) },
			features: {
				items: Array.from({ length: 51 }, () => ({
					title: 'Card',
					text: 'Text',
					html: '<script>'
				}))
			},
			apiEnabled: true
		}
	})
	assert.equal(result.ecosystem.hero.title, '')
	assert.equal(
		result.ecosystem.hero.subtitle,
		DEFAULT_HOME_PAGE_CONTENT.ecosystem.hero.subtitle
	)
	assert.equal(result.ecosystem.plans.enabled, false)
	assert.deepEqual(result.ecosystem.faq.items, [])
	assert.equal(
		result.crmProduct.hero.title,
		DEFAULT_HOME_PAGE_CONTENT.crmProduct.hero.title
	)
	assert.equal(result.crmProduct.features.items.length, 50)
	assert.equal('html' in result.crmProduct.features.items[0], false)
	assert.equal('apiEnabled' in result.crmProduct, false)
	assert.equal('appUrl' in result.ecosystem, false)
})

test('sitemap preserves stored entries without adding withdrawn product URLs', () => {
	const stored = {
		technicalSeo: {
			sitemapItems: [
				{
					path: '/',
					priority: 1,
					changeFrequency: 'weekly',
					enabled: true
				},
				{
					path: '/products/crm',
					priority: 0.2,
					changeFrequency: 'monthly',
					enabled: false
				},
				{
					path: '/custom-public',
					priority: 0.4,
					changeFrequency: 'yearly',
					enabled: true
				}
			]
		}
	}
	const once = normalizeHomePageContent(stored)
	const twice = normalizeHomePageContent(once)
	assert.deepEqual(
		twice.technicalSeo.sitemapItems,
		once.technicalSeo.sitemapItems
	)
	assert.deepEqual(
		once.technicalSeo.sitemapItems,
		stored.technicalSeo.sitemapItems
	)
	assert.equal(
		once.technicalSeo.sitemapItems.filter(
			item => item.path === '/products/widgets'
		).length,
		0
	)
	assert.equal(
		once.technicalSeo.sitemapItems.filter(
			item => item.path === '/products/crm'
		).length,
		1
	)
})

test('CMS opens the original home editor and keeps raw-code access protected', async () => {
	const settings = await readFile(
		new URL('../AdminContentSettings.tsx', editorPath),
		'utf8'
	)
	assert.match(settings, /key: 'home', label: 'Главная страница'/)
	assert.match(settings, /useState<ContentArea>\('home'\)/)
	assert.doesNotMatch(settings, /Главная экосистемы|products\//)
	assert.doesNotMatch(editorSource, /ProductContentFields|products\//)
	assert.match(editorSource, /Сохранить главную/)
	assert.match(editorSource, /isRawArea && !canEditRawCode/)
})

test('sitemap keeps custom entries and explicit empty lists without filling spare slots', () => {
	for (const length of [0, 98, 99, 100]) {
		const sitemapItems = Array.from({ length }, (_, index) => ({
			path: `/existing-${index}`,
			enabled: index % 2 === 0,
			priority: 0.5,
			changeFrequency: 'monthly'
		}))
		const normalized = normalizeHomePageContent({
			technicalSeo: { sitemapItems }
		})
		assert.equal(normalized.technicalSeo.sitemapItems.length, length)
		assert.deepEqual(normalized.technicalSeo.sitemapItems, sitemapItems)
	}
})
