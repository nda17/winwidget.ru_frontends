import { resolveWorkspaceSource } from './resolve-workspace-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const paths = {
	adminPayments: resolveWorkspaceSource(
		'src/screens/admin/ui/payments/AdminPayments.tsx'
	),
	paymentsApi: resolveWorkspaceSource(
		'src/features/manage-payments/api/payments.api.ts'
	),
	billingSettingsApi: resolveWorkspaceSource(
		'src/entities/billing-settings/api/billing-settings.api.ts'
	),
	billingSettingsTypes: resolveWorkspaceSource(
		'src/entities/billing-settings/model/billing-settings.types.ts'
	),
	eventLogApi: resolveWorkspaceSource(
		'src/features/view-event-log/api/event-log.api.ts'
	),
	eventLogUi: resolveWorkspaceSource(
		'src/screens/admin/ui/event-log/AdminEventLog.tsx'
	)
}

const sources = Object.fromEntries(
	await Promise.all(
		Object.entries(paths).map(async ([key, path]) => [
			key,
			await readFile(path, 'utf8')
		])
	)
)

const adminPaymentsFile = ts.createSourceFile(
	paths.adminPayments.pathname,
	sources.adminPayments,
	ts.ScriptTarget.Latest,
	true,
	ts.ScriptKind.TSX
)

const findArrowFunction = name => {
	let result = null

	const visit = node => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === name &&
			ts.isArrowFunction(node.initializer)
		) {
			result = node.initializer
			return
		}

		ts.forEachChild(node, visit)
	}

	visit(adminPaymentsFile)
	return result
}

test('uses the frozen readiness and DEV resolution endpoints', () => {
	assert.match(
		sources.billingSettingsApi,
		/axiosInterceptorsRequest\.get\(\s*['"]\/billing-settings\/admin\/provider-readiness['"]\s*\)/
	)
	assert.match(
		sources.paymentsApi,
		/axiosInterceptorsRequest\.post\(\s*['"]\/payments\/dev\/unknown-provider\/resolve['"]\s*,\s*payload\s*\)/
	)
	assert.match(
		sources.paymentsApi,
		/axiosInterceptorsRequest\.get\(\s*`\/payments\/dev\/unknown-provider\/\$\{encodeURIComponent\(paymentId\)\}\/evidence`\s*\)/
	)
})

test('keeps live provider configuration and errors without release checklist clutter', () => {
	assert.match(sources.adminPayments, /Настройки платёжного провайдера/)
	assert.match(sources.adminPayments, /isProviderReadinessError/)
	assert.match(
		sources.adminPayments,
		/Не удалось загрузить настройки платёжного провайдера/
	)
	assert.match(sources.adminPayments, /providerReadiness\.provider\.mode/)
	assert.doesNotMatch(
		sources.adminPayments,
		/Не проверено внешне|Внешняя проверка|readinessExternal/
	)
})

test('labels normalized and raw provider receipt persistence honestly', () => {
	assert.match(
		sources.billingSettingsTypes,
		/normalizedStoredFields:\s*string\[\]/
	)
	assert.match(
		sources.billingSettingsTypes,
		/rawProviderResponseStored:\s*true/
	)
	assert.match(
		sources.billingSettingsTypes,
		/duplicateDeliveryFence:\s*['"]authenticated-provider-object-reverification['"]/
	)
	assert.match(
		sources.adminPayments,
		/Нормализованные сохраняемые provider-поля/
	)
	assert.match(sources.adminPayments, /Raw provider response/)
	assert.doesNotMatch(sources.billingSettingsTypes, /storedProviderFields/)
})

test('builds one idempotent command per confirmed DEV submit', () => {
	const handler = findArrowFunction('handleUnknownProviderResolution')
	assert.ok(handler)
	assert.ok(ts.isBlock(handler.body))

	const handlerText = handler.body.getText(adminPaymentsFile)
	assert.match(handlerText, /if \(!isDev\)/)
	assert.equal(handlerText.match(/crypto\.randomUUID\(\)/g)?.length, 1)
	assert.match(handlerText, /schemaVersion:\s*1/)
	assert.match(
		handlerText,
		/resolution:\s*['"]PROVIDER_PAYMENT_NOT_FOUND['"]/
	)
	assert.match(handlerText, /providerReconciliationConfirmed:\s*true/)
	assert.match(handlerText, /checkedMetadataPaymentId/)
	assert.match(handlerText, /checkedProviderIdempotencyKey/)
	assert.match(handlerText, /toast\.promise\(promise/)
	assert.match(
		handlerText,
		/!resolutionEvidence\s*\|\|\s*resolutionEvidence\.paymentId !== paymentId/
	)
})

test('loads immutable DEV evidence before enabling resolution', () => {
	const handler = findArrowFunction('handleLoadUnknownProviderEvidence')
	assert.ok(handler)
	assert.ok(ts.isBlock(handler.body))

	const handlerText = handler.body.getText(adminPaymentsFile)
	assert.match(handlerText, /if \(!isDev\)/)
	assert.match(
		handlerText,
		/loadUnknownProviderEvidenceMutation\.mutateAsync\(paymentId\)/
	)
	assert.match(handlerText, /toast\.promise\(promise/)
	assert.match(sources.adminPayments, /['"]Загрузить evidence['"]/)
	assert.match(sources.adminPayments, /setResolutionEvidence\(null\)/)
	assert.match(sources.adminPayments, /isDev && resolutionEvidence &&/)
	assert.match(
		sources.adminPayments,
		/value=\{resolutionEvidence\.paymentId\}[\s\S]*?readOnly/
	)
	assert.match(
		sources.adminPayments,
		/resolutionEvidence\.providerOperation\.idempotencyKey[\s\S]*?readOnly/
	)
	assert.match(sources.adminPayments, /!isResolutionEvidenceReady/)
	assert.match(sources.adminPayments, /checkoutExpiresAt/)
	assert.match(sources.adminPayments, /providerOperation\.kind/)
})

test('keeps ADMIN read-only and exposes only the explicit DEV block', () => {
	assert.match(
		sources.adminPayments,
		/const isDev = Boolean\(user\?\.rights\?\.includes\(UserRole\.DEV\)\)/
	)
	assert.match(
		sources.adminPayments,
		/const isResolutionLocked = !isUserLoading && !isDev/
	)
	assert.match(sources.adminPayments, /resolutionContentBlurred/)
	assert.match(sources.adminPayments, /Ручное разрешение заблокировано/)
	assert.match(
		sources.adminPayments,
		/type=['"]checkbox['"][\s\S]*providerReconciliationConfirmed/
	)
	assert.match(
		sources.adminPayments,
		/invalidateQueries\(\{ queryKey: \['admin-payments'\] \}\)/
	)
	assert.doesNotMatch(
		sources.adminPayments,
		/provider\.(?:shopId|secretKey)(?!Configured)/
	)
})

test('labels the Operations audit action exactly as the backend contract', () => {
	assert.match(
		sources.eventLogApi,
		/['"]PAYMENT_UNKNOWN_PROVIDER_RESOLVED['"]/
	)
	assert.match(
		sources.eventLogUi,
		/PAYMENT_UNKNOWN_PROVIDER_RESOLVED:\s*['"]Ручное разрешение неизвестного платежа['"]/
	)
})
