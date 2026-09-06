import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const shared = new URL('../packages/winwidget-web/src/', import.meta.url)
const source = await Promise.all(
	[
		'shared/config/pages/public.config.ts',
		'shared/api/clear-session.ts',
		'features/auth/model/SessionProvider.tsx'
	].map(
		async path =>
			ts.transpileModule(await readFile(new URL(path, shared), 'utf8'), {
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					jsx: ts.JsxEmit.ReactJSX
				}
			}).outputText
	)
)

function load(code, dependencies = {}, globals = {}) {
	const exports = {}
	vm.runInNewContext(code, {
		exports,
		require: name => {
			assert.ok(
				Object.hasOwn(dependencies, name),
				`Unexpected dependency ${name}`
			)
			return dependencies[name]
		},
		...globals
	})
	return exports
}

const policy = load(source[0])
function fixture(pathname) {
	const redirects = [],
		events = [],
		listeners = new Map()
	let removed = 0
	const window = {
		location: { pathname, replace: url => redirects.push(url) },
		dispatchEvent: event => {
			events.push(event.type)
			listeners.get(event.type)?.()
		},
		addEventListener: (name, handler) => listeners.set(name, handler),
		removeEventListener: name => listeners.delete(name)
	}
	const api = load(
		source[1],
		{
			'@/shared/config/pages/public.config': policy,
			'./token-storage': { removeFromStorage: () => removed++ }
		},
		{ window, Event }
	)
	return {
		window,
		api,
		redirects,
		events,
		get removed() {
			return removed
		}
	}
}

for (const path of [
	'/',
	'/products/widgets',
	'/products/crm',
	'/payment',
	'/login',
	'/register',
	'/restore-password',
	'/legal-documentation/oferta',
	'/logout',
	'/administrator',
	'/cabinet-public',
	'/page-wheel/public-demo',
	'/page-quiz/public-demo',
	'/page-callback/public-demo',
	'/page-timer/public-demo',
	'/page-stop-offer/public-demo',
	'/page-calculator/public-demo',
	'/page-ai-consultant/public-demo'
]) {
	test(`expired session clears private state without redirecting public path ${path}`, () => {
		const state = fixture(path)
		state.api.clearBrowserSession()
		assert.equal(state.removed, 1)
		assert.deepEqual(state.events, ['winwidget:session-cleared'])
		assert.deepEqual(state.redirects, [])
	})
}
for (const path of [
	'/cabinet',
	'/cabinet/sessions',
	'/admin',
	'/admin/content',
	'/admin/crm',
	'/payment/success',
	...[
		'wheels',
		'quizzes',
		'callbacks',
		'timers',
		'stop-offers',
		'calculators'
	].map(kind => `/${kind}/widget-id/leads`)
]) {
	test(`expired session still redirects protected path ${path}`, () => {
		const state = fixture(path)
		state.api.clearBrowserSession()
		assert.equal(state.removed, 1)
		assert.deepEqual(state.events, ['winwidget:session-cleared'])
		assert.deepEqual(state.redirects, ['/login'])
	})
}

test('explicit logout suppression and explicit redirect retain their contract', () => {
	const state = fixture('/cabinet')
	state.api.clearBrowserSession({ redirectToLogin: false })
	assert.deepEqual(state.redirects, [])
	state.window.location.pathname = '/payment'
	state.api.clearBrowserSession({ redirectToLogin: true })
	assert.deepEqual(state.redirects, ['/login'])
	state.window.location.pathname = '/login'
	state.api.clearBrowserSession({ redirectToLogin: true })
	assert.deepEqual(state.redirects, ['/login'])
})

for (const [start, finish] of [
	['/', '/'],
	['/products/crm', '/products/crm'],
	['/admin', '/admin'],
	['/admin/content', '/products/widgets'],
	['/products/widgets', '/cabinet']
]) {
	test(`actual SessionProvider handles failed refresh using current path ${start} -> ${finish}`, async () => {
		const state = fixture(start)
		const refs = [],
			effects = [],
			auth = [],
			resolved = []
		let index = 0,
			path = start,
			rejectRefresh,
			clears = 0
		const refresh = new Promise((_, reject) => {
			rejectRefresh = reject
		})
		const provider = load(
			source[2],
			{
				'@/shared/config/pages/public.config': policy,
				'@/shared/api': {
					...state.api,
					getAccessToken: () => null,
					isAccessTokenValid: () => false
				},
				'@/features/auth/api/auth.api': {
					default: { getNewTokens: () => refresh }
				},
				'@/entities/user': {
					useAuthStore: selector =>
						selector({
							setAuth: value => auth.push(value),
							setAuthResolved: value => resolved.push(value)
						})
				},
				'@tanstack/react-query': {
					useQueryClient: () => ({
						clear: () => clears++,
						removeQueries() {},
						invalidateQueries() {}
					})
				},
				'next/navigation': { usePathname: () => path },
				react: {
					useCallback: callback => callback,
					useRef: value => {
						const slot = index++
						return refs[slot] ?? (refs[slot] = { current: value })
					},
					useEffect: effect => effects.push(effect)
				},
				'react/jsx-runtime': { jsx: () => null, Fragment: 'fragment' }
			},
			{
				window: state.window,
				Event,
				document: { addEventListener() {}, removeEventListener() {} }
			}
		).default
		provider({ children: null, hasSessionHint: true })
		const cleanup = effects
			.splice(0)
			.map(effect => effect())
			.filter(Boolean)
		path = finish
		state.window.location.pathname = finish
		index = 0
		provider({ children: null, hasSessionHint: true })
		rejectRefresh(new Error('Synthetic expired session'))
		await new Promise(resolve => setImmediate(resolve))
		assert.equal(state.removed, 1)
		assert.equal(clears, 1)
		assert.equal(auth.at(-1), false)
		assert.equal(resolved.at(-1), true)
		assert.deepEqual(
			state.redirects,
			policy.isSessionProtectedPath(finish) ? ['/login'] : []
		)
		cleanup.forEach(dispose => dispose())
	})
}
