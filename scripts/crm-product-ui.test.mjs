import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const compile = (source, imports = {}, env = {}) => {
	const compiled = ts.transpileModule(source, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.CommonJS,
			jsx: ts.JsxEmit.ReactJSX
		}
	}).outputText
	const module = { exports: {} }
	new Function('exports', 'module', 'require', 'process', compiled)(
		module.exports,
		module,
		name => {
			if (Object.hasOwn(imports, name)) return imports[name]
			if (name === 'react/jsx-runtime') return require(name)
			throw new Error(`Unexpected import: ${name}`)
		},
		{ env }
	)
	return module.exports
}
const contractSource = await read(
	'apps/widgets/src/entities/crm-product/model/crm-product.contract.ts'
)
const contract = compile(contractSource)
const adminContract = compile(
	await read(
		'packages/winwidget-web/src/features/admin-crm/model/crm-pricing.contract.ts'
	)
)
const accessContract = compile(
	await read(
		'apps/crm/src/entities/crm-access/model/crm-access.parser.ts'
	),
	{
		'@/entities/crm-access/model/crm-access.types': compile(
			await read(
				'apps/crm/src/entities/crm-access/model/crm-access.types.ts'
			)
		),
		'@/shared/lib/contract': compile(
			await read('apps/crm/src/shared/lib/contract.ts')
		)
	}
)

const policy = () => ({
	schemaVersion: 1,
	productCode: 'WINCRM',
	version: 7,
	currency: 'RUB',
	monthlyPriceMinor: 99001,
	yearlyPriceMinor: 900001,
	additionalSeatMonthlyPriceMinor: 15001,
	additionalSeatYearlyPriceMinor: 150001,
	includedSeats: 2,
	trialSeatLimit: 2,
	trialDays: 5,
	graceDays: 3,
	createdAt: '2026-09-05T10:00:00.000Z'
})
const workspaceId = '11111111-1111-4111-8111-111111111111'
const membershipId = '22222222-2222-4222-8222-222222222222'
const access = () => ({
	schemaVersion: 1,
	state: 'ACTIVE',
	selectedWorkspaceId: workspaceId,
	membership: { membershipId, role: 'OWNER' },
	workspaces: [{ workspaceId, membershipId, role: 'OWNER' }],
	entitlementStatus: 'ACTIVE',
	entitlement: {
		id: '33333333-3333-4333-8333-333333333333',
		workspaceId,
		planCode: 'TRIAL',
		seatLimit: 2,
		policyVersion: 1,
		graceUntil: '2026-09-13T00:00:00.000Z',
		trialStartedAt: '2026-09-05T00:00:00.000Z',
		effectiveFrom: '2026-09-05T00:00:00.000Z',
		effectiveUntil: '2026-09-10T00:00:00.000Z',
		aggregateVersion: '1',
		sourceSequence: '1'
	},
	access: { lifecycle: 'ACTIVE' }
})

test('customer pricing accepts the same exact Billing policy as the existing admin reader', () => {
	assert.deepEqual(
		contract.parseCrmCommercialPolicy(policy()),
		adminContract.parseCrmPricingSettings(policy())
	)
	const updated = { ...policy(), includedSeats: 8, trialSeatLimit: 3 }
	assert.equal(contract.parseCrmCommercialPolicy(updated).includedSeats, 8)
	assert.equal(
		contract.parseCrmCommercialPolicy(updated).trialSeatLimit,
		3
	)
})

test('customer pricing rejects incomplete, foreign, malformed and invented policy fields', () => {
	for (const override of [
		{ schemaVersion: 2 },
		{ productCode: 'WIDGETS' },
		{ currency: 'USD' },
		{ includedSeats: 1 },
		{ trialSeatLimit: 1 },
		{ includedSeats: 10_001 },
		{ monthlyPriceMinor: 0 },
		{ yearlyPriceMinor: '900001' },
		{ additionalSeatMonthlyPriceMinor: 1.5 },
		{ version: 0 },
		{ createdAt: '2026-02-31T00:00:00.000Z' },
		{ unknown: true }
	]) {
		assert.throws(() =>
			contract.parseCrmCommercialPolicy({ ...policy(), ...override })
		)
		assert.throws(() =>
			adminContract.parseCrmPricingSettings({ ...policy(), ...override })
		)
	}
	for (const key of Object.keys(policy())) {
		const value = policy()
		delete value[key]
		assert.throws(() => contract.parseCrmCommercialPolicy(value))
	}
})

test('profile separates Trial and paid CRM status without consulting Widgets', () => {
	assert.deepEqual(contract.parseCrmProfileStatus(access()), {
		label: 'Пробный период',
		tone: 'active',
		expiresAt: '2026-09-10T00:00:00.000Z'
	})
	const paid = access()
	paid.entitlement.planCode = 'WINCRM'
	paid.entitlement.trialStartedAt = null
	assert.equal(contract.parseCrmProfileStatus(paid).label, 'Активна')
	assert.doesNotMatch(
		contractSource,
		/subscriptionService|EASY|HARD|localStorage/
	)
})

test('profile lifecycle acceptance matches the full CRM access reader exhaustively', () => {
	const states = [
		'NOT_ACTIVATED',
		'ONBOARDING',
		'ACTIVE',
		'GRACE',
		'READ_ONLY',
		'SUSPENDED',
		'EXPIRED',
		'CANCELLED'
	]
	const statuses = states.filter(value => value !== 'ONBOARDING')
	const lifecycles = [
		null,
		'ONBOARDING',
		'ACTIVE',
		'READ_ONLY',
		'SUSPENDED'
	]
	for (const state of states)
		for (const entitlementStatus of statuses)
			for (const lifecycle of lifecycles) {
				const response = {
					...access(),
					state,
					entitlementStatus,
					access: lifecycle ? { lifecycle } : null
				}
				if (entitlementStatus === 'NOT_ACTIVATED')
					response.entitlement = null
				const accepted =
					accessContract.parseCrmAccessBootstrap(response) !== null
				if (accepted)
					assert.doesNotThrow(
						() => contract.parseCrmProfileStatus(response),
						`${state}/${entitlementStatus}/${lifecycle}`
					)
				else
					assert.throws(
						() => contract.parseCrmProfileStatus(response),
						`${state}/${entitlementStatus}/${lifecycle}`
					)
			}
})

test('profile uses authoritative GRACE expiry and never labels read-only as active', () => {
	const grace = { ...access(), state: 'GRACE', entitlementStatus: 'GRACE' }
	assert.deepEqual(contract.parseCrmProfileStatus(grace), {
		label: 'Льготный период',
		tone: 'warning',
		expiresAt: grace.entitlement.graceUntil
	})
	assert.deepEqual(
		contract.parseCrmProfileStatus({
			...access(),
			state: 'READ_ONLY',
			entitlementStatus: 'READ_ONLY'
		}),
		{
			label: 'Только просмотр',
			tone: 'warning',
			expiresAt: null
		}
	)
})

test('ambiguous workspaces require selection instead of choosing the first subscription', () => {
	const response = {
		schemaVersion: 1,
		state: 'WORKSPACE_SELECTION_REQUIRED',
		selectedWorkspaceId: null,
		workspaces: access().workspaces
	}
	assert.ok(accessContract.parseCrmAccessBootstrap(response))
	assert.deepEqual(contract.parseCrmProfileStatus(response), {
		label: 'Выберите рабочее пространство',
		tone: 'neutral',
		expiresAt: null
	})
	assert.throws(() =>
		contract.parseCrmProfileStatus({
			...response,
			selectedWorkspaceId: workspaceId
		})
	)
})

test('profile rejects stale DTOs, foreign workspace membership and malformed entitlement snapshots', () => {
	const values = [
		{
			...access(),
			membership: { ...access().membership, role: 'MEMBER' }
		},
		{ ...access(), selectedWorkspaceId: membershipId },
		{
			...access(),
			workspaces: [...access().workspaces, ...access().workspaces]
		},
		{ ...access(), access: { lifecycle: 'ACTIVE', extra: true } },
		{ ...access(), unknown: true }
	]
	for (const patch of [
		{ workspaceId: membershipId },
		{ price: 999 },
		{ graceUntil: null },
		{ seatLimit: 1 },
		{ aggregateVersion: 1 },
		{ sourceSequence: '0' },
		{ effectiveUntil: '2026-02-31T00:00:00.000Z' },
		{ effectiveFrom: '2026-09-11T00:00:00.000Z' },
		{ trialStartedAt: null }
	])
		values.push({
			...access(),
			entitlement: { ...access().entitlement, ...patch }
		})
	for (const value of values) {
		assert.equal(accessContract.parseCrmAccessBootstrap(value), null)
		assert.throws(() => contract.parseCrmProfileStatus(value))
	}
	for (const key of Object.keys(access().entitlement)) {
		const value = access()
		delete value.entitlement[key]
		assert.throws(() => contract.parseCrmProfileStatus(value))
	}
})

test('shared CRM release follows the exact build flag and remains closed by default', async () => {
	const source = await read(
		'packages/winwidget-web/src/shared/config/crm-release.config.ts'
	)
	for (const value of [undefined, 'false', '1', 'TRUE', 'true']) {
		assert.equal(
			compile(source, {}, { NEXT_PUBLIC_WINCRM_ENABLED: value })
				.CRM_RELEASE.apiEnabled,
			value === 'true'
		)
		const billing = compile(
			source,
			{},
			{ NEXT_PUBLIC_WINCRM_BILLING_ENABLED: value }
		).CRM_RELEASE
		assert.equal(billing.billingEnabled, value === 'true')
		assert.equal(billing.apiEnabled, false)
	}
})

test('unreleased CRM cannot call APIs even through a direct service retry', async () => {
	let calls = 0
	const config = compile(
		await read(
			'packages/winwidget-web/src/shared/config/crm-release.config.ts'
		)
	)
	assert.equal(config.CRM_RELEASE.apiEnabled, false)
	const { crmProductService } = compile(
		await read(
			'apps/widgets/src/entities/crm-product/api/crm-product.api.ts'
		),
		{
			'@/shared/api': {
				axiosInterceptorsRequest: {
					get: async () => {
						calls++
						return { data: policy() }
					}
				}
			},
			'@/shared/config/crm-release.config': config,
			'../model/crm-product.contract': contract
		}
	)
	await assert.rejects(crmProductService.getPolicy(), /not released/)
	await assert.rejects(
		crmProductService.getProfileStatus(),
		/not released/
	)
	assert.equal(calls, 0)
})

test('released read-only product APIs use exact contracts and cancellation, never payment endpoints', async () => {
	const calls = []
	const signal = new AbortController().signal
	const { crmProductService } = compile(
		await read(
			'apps/widgets/src/entities/crm-product/api/crm-product.api.ts'
		),
		{
			'@/shared/api': {
				axiosInterceptorsRequest: {
					get: async (path, options) => {
						calls.push({ path, options })
						return {
							data: path === '/billing-settings/crm' ? policy() : access()
						}
					}
				}
			},
			'@/shared/config/crm-release.config': {
				CRM_RELEASE: { apiEnabled: true }
			},
			'../model/crm-product.contract': contract
		}
	)
	await crmProductService.getPolicy(signal)
	await crmProductService.getProfileStatus(signal)
	assert.deepEqual(
		calls,
		['/billing-settings/crm', '/crm/access/bootstrap'].map(path => ({
			path,
			options: { signal, timeout: 15_000 }
		}))
	)
})

test('payment switch defaults to Widgets and changes only product selection and toast', async () => {
	const source = await read(
		'apps/widgets/src/screens/payment/ui/pricing/Pricing.tsx'
	)
	assert.match(source, /useState<'WIDGETS' \| 'CRM'>\('WIDGETS'\)/)
	assert.match(
		source,
		/<fieldset[\s\S]*?<legend[^>]*>Выберите продукт<\/legend>/
	)
	assert.match(source, /type="radio"[\s\S]*?name="payment-product"/)
	const switchMarkup = source.slice(
		source.indexOf('<fieldset'),
		source.indexOf('</fieldset>')
	)
	assert.match(switchMarkup, /setProduct\(value\)/)
	assert.match(switchMarkup, /toast\(/)
	assert.doesNotMatch(
		switchMarkup,
		/setPeriod|setAutoRenew|startPayment|mutate|cancelPending|setPaymentEmail|setPendingPayment/
	)
	assert.match(source, /<CrmPricingCards \/>/)
	const cards = await read(
		'apps/widgets/src/screens/payment/ui/pricing/CrmPricingCards.tsx'
	)
	assert.doesNotMatch(
		cards,
		/subscriptionService|tariffPricesService|useMutation|window\.open|localStorage|sessionStorage/
	)
	assert.match(cards, /crmProductService\.getPolicy/)
})

test('Widgets and CRM payment cards share responsive card styling without duplicate feature markers', async () => {
	const pricing = await read(
		'apps/widgets/src/screens/payment/ui/pricing/Pricing.tsx'
	)
	const cards = await read(
		'apps/widgets/src/screens/payment/ui/pricing/CrmPricingCards.tsx'
	)
	const styles = await read(
		'apps/widgets/src/screens/payment/ui/pricing/Pricing.module.scss'
	)
	const crmStyles = await read(
		'apps/widgets/src/screens/payment/ui/pricing/CrmPricingCards.module.scss'
	)
	assert.match(
		cards,
		/import pricingStyles from '\.\/Pricing\.module\.scss'/
	)
	for (const className of [
		'plans',
		'planCard',
		'planName',
		'planSubtitle',
		'priceBlock',
		'price',
		'pricePer',
		'features',
		'buyBtn'
	]) {
		assert.ok(cards.includes(`pricingStyles.${className}`), className)
		assert.ok(pricing.includes(`styles.${className}`), className)
	}
	assert.doesNotMatch(
		cards,
		/Отдельный продукт|styles\.(?:cards|card|price|paymentLink|soon)\b/
	)
	assert.doesNotMatch(
		crmStyles,
		/\.(?:eyebrow|cards|card|price|features|paymentLink|soon)\s*\{/
	)
	assert.match(cards, /Подписки CRM и Widgets оплачиваются независимо/)
	assert.match(styles, /lg:max-w-\[57\.5rem\] lg:grid-cols-2/)
	const cardStyle = styles.match(/\.planCard\s*\{([^}]+)\}/)?.[1] ?? ''
	assert.match(cardStyle, /lg:min-h-\[38rem\]/)
	assert.doesNotMatch(
		cardStyle,
		/(?:^|\s)(?:h-\[|min-h-\[)|overflow-hidden|height\s*:/
	)
	assert.ok(pricing.includes("feature.replace(/^\\s*[✓✔]\\s*/, '')"))
	assert.doesNotMatch(
		pricing,
		/PLAN_COLORS|style=\{\{ (?:color|background):/
	)
})

test('unreleased cards and profile render honest status without inferred price or expiry', async () => {
	const { renderToStaticMarkup } = require('react-dom/server')
	const { createElement } = require('react')
	const config = compile(
		await read(
			'packages/winwidget-web/src/shared/config/crm-release.config.ts'
		)
	)
	const queries = []
	const user = { id: 'synthetic-ui-user' }
	const authState = { auth: true, isAuthResolved: true }
	const imports = {
		'@/entities/crm-product': { crmProductService: {} },
		'@/entities/user': {
			useUser: () => ({ user, isLoading: false }),
			useAuthStore: selector => selector(authState)
		},
		'@/shared/config/crm-release.config': config,
		'@/shared/config/pages/public.config': {
			PUBLIC_PAGES: { LOGIN: '/login' }
		},
		'@/shared/lib/navigation/ZoneLink': { default: 'a' },
		'@tanstack/react-query': {
			useQuery: options => {
				queries.push(options)
				return {}
			}
		},
		'react-hot-toast': { default: () => {} },
		'./Pricing.module.scss': { default: {} },
		'./CrmPricingCards.module.scss': { default: {} },
		'./CrmStatusBadge.module.scss': { default: {} }
	}
	const Cards = compile(
		await read(
			'apps/widgets/src/screens/payment/ui/pricing/CrmPricingCards.tsx'
		),
		imports
	).default
	const Badge = compile(
		await read('apps/widgets/src/screens/cabinet/ui/CrmStatusBadge.tsx'),
		imports
	).default
	const cards = renderToStaticMarkup(createElement(Cards))
	const badge = renderToStaticMarkup(createElement(Badge))
	assert.match(cards, /На месяц/)
	assert.match(cards, /На год/)
	assert.equal((cards.match(/disabled=""/g) ?? []).length, 2)
	assert.match(cards, /5 дней/)
	assert.doesNotMatch(cards, /990|9000|₽|Оплатить/)
	assert.match(badge, /WinCRM/)
	assert.match(badge, /Скоро/)
	assert.doesNotMatch(badge, /Активна|МСК|Hard|href=/)
	assert.ok(queries.every(query => query.enabled === false))
	const RunningCards = compile(
		await read(
			'apps/widgets/src/screens/payment/ui/pricing/CrmPricingCards.tsx'
		),
		{
			...imports,
			'@/shared/config/crm-release.config': {
				CRM_RELEASE: { ...config.CRM_RELEASE, apiEnabled: true }
			}
		}
	).default
	const runningCards = renderToStaticMarkup(createElement(RunningCards))
	assert.equal((runningCards.match(/Оплата скоро/g) ?? []).length, 2)
	assert.equal((runningCards.match(/disabled=""/g) ?? []).length, 2)
	assert.match(runningCards, /Онлайн-оплата WinCRM пока недоступна/)
	assert.doesNotMatch(
		runningCards,
		/Продажи откроются после запуска WinCRM/
	)
})

test('paid Widgets cards navigate to CRM settings only when both gates are open, never creating payments or forwarding guessed checkout fields', async () => {
	const { renderToStaticMarkup } = require('react-dom/server')
	const { createElement } = require('react')
	const configSource = await read(
		'packages/winwidget-web/src/shared/config/crm-release.config.ts'
	)
	const cardsSource = await read(
		'apps/widgets/src/screens/payment/ui/pricing/CrmPricingCards.tsx'
	)
	const toasts = [],
		queries = [],
		links = []
	const authState = { auth: true, isAuthResolved: true }
	const imports = {
		'@/entities/crm-product': {
			crmProductService: { getPolicy: () => policy() }
		},
		'@/entities/user': {
			useUser: () => ({
				user: { id: 'synthetic-ui-user' },
				isLoading: false
			}),
			useAuthStore: selector => selector(authState)
		},
		'@/shared/config/pages/public.config': {
			PUBLIC_PAGES: { LOGIN: '/login' }
		},
		'@/shared/lib/navigation/ZoneLink': {
			default: props => {
				links.push(props)
				return createElement('a', props)
			}
		},
		'@tanstack/react-query': {
			useQuery: options => {
				queries.push(options)
				return { data: policy(), isError: false }
			}
		},
		'react-hot-toast': { default: value => toasts.push(value) },
		'./Pricing.module.scss': { default: {} },
		'./CrmPricingCards.module.scss': { default: {} }
	}
	for (const [apiEnabled, billingEnabled] of [
		[true, true],
		[true, false],
		[false, true],
		[false, false]
	]) {
		links.length = 0
		const config = compile(
			configSource,
			{},
			{
				NEXT_PUBLIC_WINCRM_ENABLED: String(apiEnabled),
				NEXT_PUBLIC_WINCRM_BILLING_ENABLED: String(billingEnabled),
				NODE_ENV: 'production'
			}
		)
		const Cards = compile(cardsSource, {
			...imports,
			'@/shared/config/crm-release.config': config
		}).default
		const markup = renderToStaticMarkup(createElement(Cards))
		if (apiEnabled && billingEnabled) {
			assert.equal(links.length, 2)
			for (const link of links) {
				assert.equal(link.href, 'https://crm.winwidget.ru/settings')
				assert.equal(link.children, 'Открыть оплату WinCRM')
				assert.equal(link.target, undefined)
				link.onClick()
			}
			assert.doesNotMatch(
				markup,
				/disabled=|Оплата скоро|workspaceId=|period=|amount=|commandId=/
			)
		} else {
			assert.equal(links.length, 0)
			assert.equal((markup.match(/disabled=""/g) ?? []).length, 2)
		}
	}
	assert.deepEqual(toasts, [
		'Открываем оплату WinCRM',
		'Открываем оплату WinCRM'
	])
	assert.ok(
		queries.every(
			query => query.queryKey[0] === 'crm-public-commercial-policy'
		)
	)
	assert.doesNotMatch(
		cardsSource,
		/useMutation|\.post\(|\.put\(|subscriptionService|paymentEnabled|autoRenewalSignupEnabled/
	)
})
