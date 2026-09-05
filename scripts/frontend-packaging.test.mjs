import assert from 'node:assert/strict'
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
	FRONTEND_APPS,
	resolveFrontendServer,
	verifyFrontendRuntime
} from './container-entrypoint.mjs'

const revision = 'a'.repeat(40)
const source = new URL('./container-entrypoint.mjs', import.meta.url)
const repositoryFile = relative =>
	readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
const fixture = (t, app = 'crm') => {
	const root = realpathSync(
		mkdtempSync(path.join(tmpdir(), 'winwidget-frontend-packaging-'))
	)
	t.after(() => rmSync(root, { recursive: true, force: true }))
	const directory = path.join(root, 'apps', app)
	mkdirSync(path.join(directory, '.next', 'static'), { recursive: true })
	mkdirSync(path.join(directory, 'public'))
	writeFileSync(
		path.join(directory, 'server.js'),
		'console.log("synthetic frontend started")'
	)
	copyFileSync(source, path.join(root, 'container-entrypoint.mjs'))
	return { root, directory }
}

for (const app of FRONTEND_APPS) {
	test(`standalone ${app} keeps its own monorepo server/static/public paths`, t => {
		const { root, directory } = fixture(t, app)
		assert.equal(
			verifyFrontendRuntime(root, app, revision),
			path.join(directory, 'server.js')
		)
	})
}

test('unknown, missing, traversal and case-altered app selectors fail closed', t => {
	const { root } = fixture(t)
	for (const app of [
		undefined,
		'',
		'CRM',
		'../crm',
		'crm/../widgets',
		'crm ',
		'all'
	]) {
		assert.throws(
			() => resolveFrontendServer(root, app),
			/^Error: Invalid frontend runtime packaging$/
		)
	}
})

test('a runtime override cannot select a neighbouring app', t => {
	const { root } = fixture(t)
	assert.throws(() => resolveFrontendServer(root, 'widgets'))
})

test('tracing another app causes a packaging failure, not a silent deletion', t => {
	const { root } = fixture(t)
	mkdirSync(path.join(root, 'apps', 'widgets'))
	assert.throws(() => verifyFrontendRuntime(root, 'crm', revision))
})

test('root shared public must not become a neighbour asset fallback', t => {
	const { root } = fixture(t)
	mkdirSync(path.join(root, 'public'))
	assert.throws(() => verifyFrontendRuntime(root, 'crm', revision))
})

for (const relative of [
	'.env',
	'apps/crm/.env.production',
	'node_modules/dependency/.env.local'
]) {
	test(`private env is rejected without reading or exposing its contents: ${relative}`, t => {
		const { root } = fixture(t)
		const target = path.join(root, relative)
		mkdirSync(path.dirname(target), { recursive: true })
		writeFileSync(target, 'synthetic-content-must-never-appear')
		assert.throws(
			() => verifyFrontendRuntime(root, 'crm', revision),
			/^Error: Invalid frontend runtime packaging$/
		)
	})
}

test('traced links can stay inside the image but cannot leave it', t => {
	const { root } = fixture(t)
	mkdirSync(path.join(root, 'node_modules', 'own'), { recursive: true })
	symlinkSync('./own', path.join(root, 'node_modules', 'safe'))
	assert.doesNotThrow(() => verifyFrontendRuntime(root, 'crm', revision))
	symlinkSync(
		path.dirname(root),
		path.join(root, 'node_modules', 'foreign')
	)
	assert.throws(() => verifyFrontendRuntime(root, 'crm', revision))
})

for (const relative of ['public', '.next/static']) {
	test(`missing ${relative} is not accepted`, t => {
		const { root, directory } = fixture(t)
		rmSync(path.join(directory, relative), { recursive: true })
		assert.throws(() => verifyFrontendRuntime(root, 'crm', revision))
	})
}

test('a symlinked server is not accepted', t => {
	const { root, directory } = fixture(t)
	rmSync(path.join(directory, 'server.js'))
	symlinkSync('missing.js', path.join(directory, 'server.js'))
	assert.throws(() => verifyFrontendRuntime(root, 'crm', revision))
})

test('image provenance requires an exact immutable Git SHA', t => {
	const { root } = fixture(t)
	for (const value of [
		undefined,
		'unknown',
		'latest',
		'a'.repeat(7),
		'A'.repeat(40),
		`${revision}\n`
	]) {
		assert.throws(() => verifyFrontendRuntime(root, 'crm', value))
	}
})

test('entrypoint verifies without starting Next; normal command starts only selected server', t => {
	const { root } = fixture(t)
	const script = path.join(root, 'container-entrypoint.mjs')
	const options = {
		cwd: root,
		encoding: 'utf8',
		env: { FRONTEND_APP: 'crm', APP_REVISION: revision }
	}
	const verify = spawnSync(process.execPath, [script, '--verify'], options)
	assert.equal(verify.status, 0)
	assert.equal(verify.stdout.trim(), 'Frontend runtime packaging verified')
	const start = spawnSync(process.execPath, [script], options)
	assert.equal(start.status, 0)
	assert.equal(start.stdout.trim(), 'synthetic frontend started')
	const invalid = spawnSync(
		process.execPath,
		[script, 'unsupported'],
		options
	)
	assert.equal(invalid.status, 1)
	assert.equal(
		invalid.stderr.trim(),
		'Frontend runtime could not be started or verified'
	)
})

test('Docker context recursively excludes generated output and private configuration', () => {
	const patterns = repositoryFile('.dockerignore').split(/\r?\n/)
	for (const pattern of [
		'**/node_modules',
		'**/.next',
		'**/.git',
		'**/.env',
		'**/.env.*',
		'deploy',
		'**/TEMP',
		'**/other_files'
	]) {
		assert.ok(
			patterns.includes(pattern),
			`Missing context exclusion ${pattern}`
		)
	}
	assert.ok(!patterns.some(line => line.startsWith('!')))
})

test('Docker runtime copies only selected standalone assets and requires an app selector', () => {
	const dockerfile = repositoryFile('Dockerfile')
	assert.match(dockerfile, /^ARG FRONTEND_APP$/m)
	assert.doesNotMatch(dockerfile, /^ARG FRONTEND_APP=/m)
	assert.match(
		dockerfile,
		/case "\$FRONTEND_APP" in landing\|widgets\|admin-panel\|crm\)/
	)
	assert.match(dockerfile, /RUN --network=none set -eu;/)
	assert.match(
		dockerfile,
		/pnpm --filter "\.\/apps\/\$\{FRONTEND_APP\}" run build/
	)
	assert.match(
		dockerfile,
		/^ARG NEXT_PUBLIC_WINCRM_BILLING_ENABLED=false$/m
	)
	assert.match(dockerfile, /^ARG NEXT_PUBLIC_WINCRM_ENABLED=false$/m)
	assert.match(
		dockerfile,
		/^ENV NEXT_PUBLIC_WINCRM_ENABLED=\$\{NEXT_PUBLIC_WINCRM_ENABLED\}$/m
	)
	assert.match(
		dockerfile,
		/case "\$NEXT_PUBLIC_WINCRM_ENABLED" in true\|false\)/
	)
	assert.match(
		dockerfile,
		/^ENV NEXT_PUBLIC_WINCRM_BILLING_ENABLED=\$\{NEXT_PUBLIC_WINCRM_BILLING_ENABLED\}$/m
	)
	const runtime = dockerfile.split('FROM node:20-alpine AS runner')[1]
	assert.ok(runtime)
	assert.match(runtime, /\/apps\/\$\{FRONTEND_APP\}\/\.next\/standalone\//)
	assert.match(runtime, /\.\/apps\/\$\{FRONTEND_APP\}\/\.next\/static\//)
	assert.match(runtime, /\.\/apps\/\$\{FRONTEND_APP\}\/public\//)
	assert.doesNotMatch(
		runtime,
		/COPY .*\/app\/(?:node_modules|public)(?:\s|\/)/
	)
	assert.match(runtime, /^USER nextjs$/m)
	assert.match(
		runtime,
		/RUN --network=none node container-entrypoint\.mjs --verify/
	)
})

test('verification CI covers all common consumers, root and CRM tests without deploy', () => {
	const workflow = repositoryFile('.github/workflows/ci.yml')
	assert.match(
		workflow,
		/pull_request:\s*\n  push:\s*\n    branches-ignore:\s*\n      - prod/
	)
	for (const app of FRONTEND_APPS)
		assert.ok(workflow.includes(`- app: ${app}\n`))
	assert.match(workflow, /node --test scripts\/\*\.test\.mjs/)
	assert.match(
		workflow,
		/pnpm --filter @winwidget\/winwidget-web run typecheck/
	)
	assert.match(workflow, /pnpm --filter wincrm-client run test/)
	assert.match(workflow, /APP_REVISION: \$\{\{ github.sha \}\}/)
	assert.match(
		workflow,
		/--build-arg NEXT_PUBLIC_WINCRM_BILLING_ENABLED=false/
	)
	assert.match(workflow, /--build-arg NEXT_PUBLIC_WINCRM_ENABLED=false/)
	assert.match(
		repositoryFile('deploy/docker-compose.prod.yml'),
		/NEXT_PUBLIC_WINCRM_ENABLED: 'false'/
	)
	assert.match(workflow, /docker run --rm --network none/)
	assert.doesNotMatch(
		workflow,
		/secrets\.|workflow_dispatch|ssh-keyscan|scp\s|ssh\s|deploy-production\.sh/
	)
	assert.doesNotMatch(workflow, /run:.*verify-auth-settings-contract\.mjs/)
})

test('each app owns standalone tracing and its correct framework generation', () => {
	for (const app of FRONTEND_APPS) {
		const manifest = JSON.parse(repositoryFile(`apps/${app}/package.json`))
		const config = repositoryFile(`apps/${app}/next.config.mjs`)
		assert.match(config, /output: 'standalone'/)
		assert.match(config, /outputFileTracingRoot:/)
		if (app === 'crm') {
			assert.equal(manifest.name, 'wincrm-client')
			assert.match(manifest.dependencies.next, /^16\./)
			assert.match(manifest.dependencies.react, /^19\./)
			assert.equal(manifest.scripts.build, 'next build --webpack')
		} else {
			assert.equal(manifest.name, `@winwidget/${app}`)
			assert.match(manifest.dependencies.next, /^\^?14\./)
			assert.match(manifest.dependencies.react, /^\^?18\./)
			assert.equal(
				manifest.scripts['sync:public'],
				`node ../../scripts/sync-public.mjs ${app}`
			)
			assert.equal(
				manifest.scripts.build,
				'pnpm run sync:public && next build'
			)
		}
	}
})
