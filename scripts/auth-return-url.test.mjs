import { resolveWorkspaceSource } from './resolve-workspace-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const modulePath = resolveWorkspaceSource(
	'src/shared/lib/auth-return-url.ts'
)
const sourceText = await readFile(modulePath, 'utf8')
const { outputText } = ts.transpileModule(sourceText, {
	compilerOptions: {
		module: ts.ModuleKind.ESNext,
		target: ts.ScriptTarget.ES2022
	}
})
const authReturn = await import(
	`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

const productionOptions = { allowLocalhost: false }
const localOptions = { allowLocalhost: true }

const createStorage = () => {
	const values = new Map()

	return {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: key => values.delete(key)
	}
}

test('operator support deep link survives the same-tab OAuth intent with a narrow allowlist', () => {
	const id = '11111111-1111-4111-8111-111111111111'
	const url = `https://winwidget.ru/admin/support?conversationId=${id}`
	const storage = createStorage()
	const now = Date.now()
	assert.equal(
		authReturn.saveAuthReturnIntent(storage, url, now, productionOptions),
		url
	)
	assert.equal(
		authReturn.readAuthReturnIntent(
			storage,
			now + 1000,
			productionOptions
		),
		url
	)
	for (const invalid of [
		url + '&token=secret',
		url + '&conversationId=' + id,
		url + '#fragment',
		url.replace('/admin/support', '/admin/settings'),
		url.replace(id, 'invalid'),
		url.replace('winwidget.ru', 'winwidget.ru.evil.test')
	])
		assert.equal(
			authReturn.getSafeAuthReturnUrl(invalid, productionOptions),
			null
		)
})

test('preserves a WinCRM invitation path through the existing origin allowlist', () => {
	const invitationId = '11111111-1111-4111-8111-111111111111'
	for (const [origin, options] of [
		['https://crm.winwidget.ru', productionOptions],
		['http://localhost:3001', localOptions]
	]) {
		const url = `${origin}/invitations/${invitationId}`
		assert.equal(authReturn.getSafeAuthReturnUrl(url, options), url)
		assert.equal(
			authReturn.withAuthReturnUrl('/login', url, options),
			`/login?returnUrl=${encodeURIComponent(url)}`
		)
	}
})

test('accepts only the exact production WinCRM origin', () => {
	assert.equal(
		authReturn.getSafeAuthReturnUrl(
			'https://crm.winwidget.ru/deals/42?tab=history#latest',
			productionOptions
		),
		'https://crm.winwidget.ru/deals/42?tab=history#latest'
	)

	for (const unsafeUrl of [
		'https://crm.winwidget.ru.evil.example/deals',
		'https://crm.winwidget.ru:444/deals',
		'https://user@crm.winwidget.ru/deals',
		'http://crm.winwidget.ru/deals',
		'https://winwidget.ru/deals',
		'//crm.winwidget.ru/deals',
		'https://crm.winwidget.ru\\@evil.example/deals',
		' https://crm.winwidget.ru/deals',
		['https://crm.winwidget.ru/deals']
	]) {
		assert.equal(
			authReturn.getSafeAuthReturnUrl(unsafeUrl, productionOptions),
			null
		)
	}
})

test('allows the exact local WinCRM origin only in local mode', () => {
	const localUrl = 'http://localhost:3001/inbox?filter=new'

	assert.equal(
		authReturn.getSafeAuthReturnUrl(localUrl, localOptions),
		localUrl
	)
	assert.equal(
		authReturn.getSafeAuthReturnUrl(localUrl, productionOptions),
		null
	)
	assert.equal(
		authReturn.getSafeAuthReturnUrl(
			'http://127.0.0.1:3001/inbox',
			localOptions
		),
		null
	)
})

test('keeps missing, invalid and valid query values distinct', () => {
	assert.equal(
		authReturn.parseAuthReturnUrlParam(undefined, productionOptions),
		undefined
	)
	assert.equal(
		authReturn.parseAuthReturnUrlParam(
			'https://evil.example',
			productionOptions
		),
		null
	)

	const params = new URLSearchParams([
		['returnUrl', 'https://crm.winwidget.ru/deals'],
		['returnUrl', 'https://crm.winwidget.ru/tasks']
	])
	assert.equal(
		authReturn.getAuthReturnUrlFromSearchParams(params, productionOptions),
		null
	)
})

test('propagates only a validated returnUrl between auth pages', () => {
	assert.equal(
		authReturn.withAuthReturnUrl(
			'/register',
			'https://crm.winwidget.ru/deals?owner=me',
			productionOptions
		),
		'/register?returnUrl=https%3A%2F%2Fcrm.winwidget.ru%2Fdeals%3Fowner%3Dme'
	)
	assert.equal(
		authReturn.withAuthReturnUrl(
			'/register',
			'https://evil.example',
			productionOptions
		),
		'/register'
	)
})

test('stores a short-lived same-tab intent and rejects tampering', () => {
	const storage = createStorage()
	const now = 1_700_000_000_000
	const returnUrl = 'https://crm.winwidget.ru/contacts'

	assert.equal(
		authReturn.saveAuthReturnIntent(
			storage,
			returnUrl,
			now,
			productionOptions
		),
		returnUrl
	)
	assert.equal(
		authReturn.readAuthReturnIntent(
			storage,
			now + 60_000,
			productionOptions
		),
		returnUrl
	)
	assert.equal(
		authReturn.readAuthReturnIntent(
			storage,
			now + 15 * 60_000 + 1,
			productionOptions
		),
		null
	)

	storage.setItem(
		authReturn.AUTH_RETURN_INTENT_STORAGE_KEY,
		JSON.stringify({ url: 'https://evil.example', createdAt: now })
	)
	assert.equal(
		authReturn.readAuthReturnIntent(storage, now, productionOptions),
		null
	)
	assert.equal(
		storage.getItem(authReturn.AUTH_RETURN_INTENT_STORAGE_KEY),
		null
	)
})

test('OAuth completion uses validated same-tab intent, not callback query', async () => {
	const socialAuthSource = await readFile(
		resolveWorkspaceSource(
			'src/screens/auth/ui/social-auth/SocialAuth.tsx'
		),
		'utf8'
	)

	assert.match(
		socialAuthSource,
		/readAuthReturnIntent\(window\.sessionStorage\)/
	)
	assert.doesNotMatch(
		socialAuthSource,
		/useSearchParams|window\.location\.search|searchParams/
	)
})

test('real OAuth completion consumes the operator support intent after renewed authentication', async () => {
	const source = await readFile(
		resolveWorkspaceSource(
			'src/screens/auth/ui/social-auth/SocialAuth.tsx'
		),
		'utf8'
	)
	const ast = ts.createSourceFile(
		'SocialAuth.tsx',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX
	)
	let effect
	const visit = node => {
		if (
			ts.isCallExpression(node) &&
			node.expression.getText(ast) === 'useEffect'
		)
			effect = node.arguments[0]
		ts.forEachChild(node, visit)
	}
	visit(ast)
	assert.ok(effect)
	const code = ts.transpileModule(
		`const run = ${effect.getText(ast)}; run();`,
		{
			compilerOptions: {
				target: ts.ScriptTarget.ES2022,
				module: ts.ModuleKind.CommonJS
			}
		}
	).outputText
	const destination =
		'https://winwidget.ru/admin/support?conversationId=11111111-1111-4111-8111-111111111111'
	const storage = createStorage()
	authReturn.saveAuthReturnIntent(
		storage,
		destination,
		Date.now(),
		productionOptions
	)
	const events = []
	new Function(
		'toast',
		'SOCIAL_AUTH_TOAST_ID',
		'readAuthReturnIntent',
		'window',
		'authService',
		'AFFILIATE_REFERRER_STORAGE_KEY',
		'setAuth',
		'setAuthResolved',
		'clearAuthReturnIntent',
		'router',
		'PUBLIC_PAGES',
		'clearBrowserSession',
		code
	)(
		{
			loading: () => 'loading',
			dismiss: () => {},
			error: () => {
				throw new Error('unexpected OAuth error')
			}
		},
		'social-auth',
		value =>
			authReturn.readAuthReturnIntent(
				value,
				Date.now(),
				productionOptions
			),
		{
			sessionStorage: storage,
			localStorage: { removeItem: () => {} },
			location: { replace: value => events.push(['destination', value]) }
		},
		{ getNewTokens: async () => {} },
		'affiliateReferrerId',
		value => events.push(['auth', value]),
		value => events.push(['resolved', value]),
		authReturn.clearAuthReturnIntent,
		{
			replace: () => {
				throw new Error('unexpected default destination')
			}
		},
		{ HOME: '/', LOGIN: '/login' },
		() => {}
	)
	await new Promise(resolve => setImmediate(resolve))
	assert.deepEqual(events, [
		['auth', true],
		['resolved', true],
		['destination', destination]
	])
	assert.equal(
		storage.getItem(authReturn.AUTH_RETURN_INTENT_STORAGE_KEY),
		null
	)
})

test('the shared login welcomes Widgets and WinCRM without changing auth inputs', async () => {
	const signInSource = await readFile(
		resolveWorkspaceSource('src/screens/auth/ui/login/SignIn.tsx'),
		'utf8'
	)
	assert.match(
		signInSource,
		/Войдите в единый аккаунт WinWidget и WinCRM\./
	)
	assert.doesNotMatch(signInSource, /управляйте виджетами в одной панели/)
	assert.match(signInSource, /authMessage=\{authMessage\}/)
	assert.match(signInSource, /authReturnUrl=\{authReturnUrl\}/)
})

test('all interactive auth completions use the guarded navigation helper', async () => {
	const authFormSource = await readFile(
		resolveWorkspaceSource('src/features/auth/model/useAuthForm.ts'),
		'utf8'
	)
	const navigationCalls =
		authFormSource.match(/navigateAfterAuth\(/g) ?? []
	const loginFallbackCalls =
		authFormSource.match(/navigateAfterAuth\(loginDestination\)/g) ?? []
	const registrationFallbackCalls =
		authFormSource.match(/navigateAfterAuth\(PUBLIC_PAGES\.CABINET\)/g) ??
		[]

	assert.equal(navigationCalls.length, 6)
	assert.equal(loginFallbackCalls.length, 3)
	assert.equal(registrationFallbackCalls.length, 2)
	assert.match(
		authFormSource,
		/isLogin \? loginDestination : PUBLIC_PAGES\.CABINET/
	)
})

test('OTP completion executes the same safe auth-return helper and synchronizes auth before navigation', async () => {
	const source = await readFile(
		resolveWorkspaceSource('src/features/auth/model/useAuthForm.ts'),
		'utf8'
	)
	const ast = ts.createSourceFile(
		'useAuthForm.ts',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	)
	let navigation, completion
	const visit = node => {
		if (
			ts.isVariableDeclaration(node) &&
			node.name.getText(ast) === 'navigateAfterAuth'
		)
			navigation = node.initializer
		if (
			ts.isPropertyAssignment(node) &&
			node.name.getText(ast) === 'completeCodeLogin'
		)
			completion = node.initializer
		ts.forEachChild(node, visit)
	}
	visit(ast)
	assert.ok(navigation && completion)
	const compiled = ts.transpileModule(
		`const navigateAfterAuth = ${navigation.getText(ast)}; const completeCodeLogin = ${completion.getText(ast)}; completeCodeLogin();`,
		{
			compilerOptions: {
				target: ts.ScriptTarget.ES2022,
				module: ts.ModuleKind.CommonJS
			}
		}
	).outputText
	const run = new Function(
		'getSafeAuthReturnUrl',
		'authReturnUrl',
		'clearAuthReturnIntent',
		'window',
		'router',
		'setAuth',
		'setAuthResolved',
		'reset',
		'queryClient',
		'loginDestination',
		compiled
	)
	for (const destination of [
		'https://crm.winwidget.ru/deals',
		'https://crm.winwidget.ru.evil.test/deals'
	]) {
		const events = []
		const storage = createStorage()
		run(
			value => authReturn.getSafeAuthReturnUrl(value, productionOptions),
			destination,
			() => events.push('clear-intent'),
			{
				sessionStorage: storage,
				location: { replace: value => events.push(['document', value]) }
			},
			{ replace: value => events.push(['router', value]) },
			value => events.push(['auth', value]),
			value => events.push(['resolved', value]),
			() => events.push('reset'),
			{
				invalidateQueries: value =>
					events.push(['invalidate', value.queryKey])
			},
			'/'
		)
		assert.deepEqual(events.slice(0, 5), [
			['auth', true],
			['resolved', true],
			'reset',
			['invalidate', ['get-profile']],
			'clear-intent'
		])
		assert.deepEqual(
			events[5],
			destination === 'https://crm.winwidget.ru/deals'
				? ['document', destination]
				: ['router', '/']
		)
	}
})

test('auth page toggles keep only a validated returnUrl', async () => {
	const authToggleSource = await readFile(
		resolveWorkspaceSource(
			'src/features/auth/ui/auth-form/auth-toggle/AuthToggle.tsx'
		),
		'utf8'
	)

	assert.match(
		authToggleSource,
		/const authPage = \(path: string\) => withAuthReturnUrl\(path, authReturnUrl\)/
	)
	assert.match(authToggleSource, /authPage\(PUBLIC_PAGES\.REGISTER\)/)
	assert.match(authToggleSource, /authPage\(PUBLIC_PAGES\.LOGIN\)/)
	assert.match(
		authToggleSource,
		/authPage\(PUBLIC_PAGES\.RESTORE_PASSWORD\)/
	)
})

test('already authenticated auth pages redirect only through the validator', async () => {
	const middlewareSource = await readFile(
		resolveWorkspaceSource('src/app/middlewares/authMiddleware.ts'),
		'utf8'
	)

	assert.match(
		middlewareSource,
		/getAuthReturnUrlFromSearchParams\(\s*request\.nextUrl\.searchParams\s*\)/
	)
	assert.match(
		middlewareSource,
		/authReturnUrl \|\| new URL\('\/', request\.url\)/
	)
})
