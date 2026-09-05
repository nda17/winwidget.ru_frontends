import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { publishFrontendStaticAssets } from './frontend-static-assets.mjs'

const revision = 'a'.repeat(40)
const fixture = t => {
	const root = fs.realpathSync(
		fs.mkdtempSync(path.join(tmpdir(), 'winwidget-static-assets-'))
	)
	t.after(() => fs.rmSync(root, { recursive: true, force: true }))
	const source = path.join(root, 'source')
	const store = path.join(root, 'assets')
	fs.mkdirSync(source)
	fs.mkdirSync(store)
	const put = (relative, bytes = 'synthetic-static-content') => {
		const target = path.join(source, relative)
		fs.mkdirSync(path.dirname(target), { recursive: true })
		fs.writeFileSync(target, bytes)
	}
	const publish = (extra = {}) =>
		publishFrontendStaticAssets({
			source,
			store,
			namespace: 'landing',
			revision,
			...extra
		})
	return { root, source, store, put, publish }
}

test('publication is repeatable, produces an immutable manifest and never overwrites files', t => {
	const { store, put, publish } = fixture(t)
	put('chunks/app/(auth)/login/page-123.js')
	put('media/font-456.woff2', Buffer.from([0, 1, 2, 255]))
	const first = publish()
	const target = path.join(
		store,
		'landing/_next/static/media/font-456.woff2'
	)
	const before = fs.statSync(target)
	const second = publish()
	assert.equal(first.files, 2)
	assert.equal(first.added, 2)
	assert.equal(second.added, 0)
	assert.equal(first.manifestSha256, second.manifestSha256)
	assert.equal(fs.statSync(target).ino, before.ino)
	assert.equal(fs.statSync(target).mtimeMs, before.mtimeMs)
	assert.equal(fs.statSync(target).mode & 0o777, 0o644)
	assert.match(first.manifestSha256, /^[a-f0-9]{64}$/)
	const manifest = JSON.parse(
		fs.readFileSync(
			path.join(store, `landing/releases/${revision}.json`),
			'utf8'
		)
	)
	assert.equal(manifest.namespace, 'landing')
	assert.equal(manifest.revision, revision)
	assert.equal(manifest.files.length, 2)
})

test('later releases retain every prior hashed chunk without automatic deletion', t => {
	const { source, store, put, publish } = fixture(t)
	put('chunks/old-123.js', 'old')
	publish()
	fs.unlinkSync(path.join(source, 'chunks/old-123.js'))
	put('chunks/new-456.js', 'new')
	publish({ revision: 'b'.repeat(40) })
	assert.equal(
		fs.readFileSync(
			path.join(store, 'landing/_next/static/chunks/old-123.js'),
			'utf8'
		),
		'old'
	)
	assert.equal(
		fs.readFileSync(
			path.join(store, 'landing/_next/static/chunks/new-456.js'),
			'utf8'
		),
		'new'
	)
	assert.equal(
		fs.readdirSync(path.join(store, 'landing/releases')).length,
		2
	)
})

test('different content at an existing path aborts before publishing any new file', t => {
	const { store, put, publish } = fixture(t)
	put('chunks/z-collision.js', 'original')
	publish()
	put('chunks/z-collision.js', 'different')
	put('chunks/a-new.js', 'not-yet-public')
	assert.throws(
		() => publish({ revision: 'b'.repeat(40) }),
		/^Error: Frontend static asset contract failed$/
	)
	assert.equal(
		fs.existsSync(
			path.join(store, 'landing/_next/static/chunks/a-new.js')
		),
		false
	)
	assert.equal(
		fs.readFileSync(
			path.join(store, 'landing/_next/static/chunks/z-collision.js'),
			'utf8'
		),
		'original'
	)
})

test('the same revision cannot be republished with another asset manifest', t => {
	const { store, put, publish } = fixture(t)
	put('first.js')
	publish()
	put('second.js')
	assert.throws(() => publish())
	assert.equal(
		fs.existsSync(path.join(store, 'landing/_next/static/second.js')),
		false
	)
})

test('all five namespaces are isolated and preserve independent legacy assets', t => {
	const { store, put, publish } = fixture(t)
	for (const namespace of [
		'legacy',
		'landing',
		'widgets',
		'admin-panel',
		'crm'
	]) {
		put('chunks/common.js', namespace)
		publish({ namespace })
	}
	for (const namespace of [
		'legacy',
		'landing',
		'widgets',
		'admin-panel',
		'crm'
	]) {
		assert.equal(
			fs.readFileSync(
				path.join(store, namespace, '_next/static/chunks/common.js'),
				'utf8'
			),
			namespace
		)
	}
})

test('namespace traversal, unknown names and mutable revisions are rejected without changes', t => {
	const { store, put, publish } = fixture(t)
	put('file.js')
	for (const namespace of [
		'../landing',
		'landing/../crm',
		'LANDING',
		'',
		'all'
	])
		assert.throws(() => publish({ namespace }))
	for (const value of [
		undefined,
		'latest',
		'a'.repeat(7),
		`${revision}\n`,
		'A'.repeat(40)
	])
		assert.throws(() => publish({ revision: value }))
	assert.deepEqual(fs.readdirSync(store), [])
})

test('empty output is not accepted as a successful image asset extraction', t => {
	const { store, publish } = fixture(t)
	assert.throws(() => publish())
	assert.deepEqual(fs.readdirSync(store), [])
})

for (const name of [
	'.env.production',
	'.hidden.js',
	'a\\b.js',
	'a\nb.js'
]) {
	test(`unsafe source file name is rejected before reading content: ${JSON.stringify(name)}`, t => {
		const { store, put, publish } = fixture(t)
		put(name)
		assert.throws(() => publish())
		assert.deepEqual(fs.readdirSync(store), [])
	})
}

test('source symlinks and hardlinks cannot smuggle files into public storage', t => {
	const { root, source, store, publish } = fixture(t)
	const other = path.join(root, 'outside.js')
	fs.writeFileSync(other, 'must-not-be-read')
	fs.symlinkSync(other, path.join(source, 'link.js'))
	assert.throws(() => publish())
	fs.unlinkSync(path.join(source, 'link.js'))
	fs.linkSync(other, path.join(source, 'hardlink.js'))
	assert.throws(() => publish())
	assert.deepEqual(fs.readdirSync(store), [])
})

test('destination directory or file symlinks fail closed and leave their targets untouched', t => {
	const { root, store, put, publish } = fixture(t)
	const outside = path.join(root, 'outside')
	fs.mkdirSync(outside)
	put('file.js')
	fs.symlinkSync(outside, path.join(store, 'landing'))
	assert.throws(() => publish())
	assert.deepEqual(fs.readdirSync(outside), [])
	fs.unlinkSync(path.join(store, 'landing'))
	publish()
	const publicFile = path.join(store, 'landing/_next/static/file.js')
	fs.unlinkSync(publicFile)
	const externalFile = path.join(outside, 'file.js')
	fs.writeFileSync(externalFile, 'unchanged')
	fs.symlinkSync(externalFile, publicFile)
	assert.throws(() => publish())
	assert.equal(fs.readFileSync(externalFile, 'utf8'), 'unchanged')
})

test('source/store roots cannot overlap or be aliases through symlinks', t => {
	const { root, source, store, put, publish } = fixture(t)
	put('file.js')
	assert.throws(() => publish({ store: source }))
	fs.mkdirSync(path.join(source, 'nested'))
	assert.throws(() => publish({ store: path.join(source, 'nested') }))
	const alias = path.join(root, 'alias')
	fs.symlinkSync(store, alias)
	assert.throws(() => publish({ store: alias }))
})

test('failure diagnostics contain no filenames, source content or private paths', t => {
	const { put, publish } = fixture(t)
	put('private-name.js', 'private-content')
	publish()
	put('private-name.js', 'different-private-content')
	assert.throws(
		() => publish(),
		/^Error: Frontend static asset contract failed$/
	)
})

test('new public assets have explicit readable modes even under a private controller umask', t => {
	const { store, put, publish } = fixture(t)
	put('chunks/file.js')
	const previous = process.umask(0o077)
	try {
		publish()
	} finally {
		process.umask(previous)
	}
	assert.equal(
		fs.statSync(path.join(store, 'landing/_next/static/chunks')).mode &
			0o777,
		0o755
	)
	assert.equal(
		fs.statSync(path.join(store, 'landing/_next/static/chunks/file.js'))
			.mode & 0o777,
		0o644
	)
})

test('unknown existing permissions are rejected, not silently widened', t => {
	const { store, put, publish } = fixture(t)
	put('chunks/file.js')
	publish()
	const target = path.join(store, 'landing/_next/static/chunks/file.js')
	fs.chmodSync(target, 0o600)
	assert.throws(() => publish())
	assert.equal(fs.statSync(target).mode & 0o777, 0o600)
	fs.chmodSync(target, 0o644)
	const directory = path.dirname(target)
	fs.chmodSync(directory, 0o700)
	assert.throws(() => publish())
	assert.equal(fs.statSync(directory).mode & 0o777, 0o700)
})

const controller = fs.readFileSync(
	new URL('./deploy-production.sh', import.meta.url),
	'utf8'
)
const workflow = fs.readFileSync(
	new URL('../.github/workflows/deploy-production.yml', import.meta.url),
	'utf8'
)

test('production workflow is opt-in, prod-only and gated by all exact-SHA verification jobs', () => {
	assert.match(
		workflow,
		/github\.ref == 'refs\/heads\/prod' && vars\.FRONTEND_PRODUCTION_RELEASE_ENABLED == 'true'/
	)
	assert.match(workflow, /actions\/workflows\/ci\.yml\/runs\?head_sha=/)
	for (const name of [
		'Workspace contracts and shared package',
		'Verify landing',
		'Verify widgets',
		'Verify admin-panel',
		'Verify crm'
	])
		assert.ok(workflow.includes(name))
	assert.match(workflow, /run\.conclusion !== 'success'/)
	assert.match(workflow, /job\.conclusion!=='success'/)
	assert.match(workflow, /needs: verify/)
	assert.match(workflow, /StrictHostKeyChecking=yes/)
	assert.match(workflow, /PRODUCTION_SSH_KNOWN_HOSTS/)
	assert.doesNotMatch(
		workflow,
		/ssh-keyscan|deploy-services-production|BACKEND_PRODUCTION/
	)
	assert.ok(
		workflow.indexOf('flock -n 9') <
			workflow.indexOf('fetch --no-tags origin prod')
	)
})

test('all builds, all candidate health checks, asset publication and DNS/TLS precede live stop', () => {
	const stop = controller.indexOf('cutover_started=true\n')
	assert.ok(stop > 0)
	for (const marker of [
		'compose build "$app"',
		'probe "$app" "${BASH_REMATCH[1]}"',
		'/controller.mjs "$namespace" "$source_revision"',
		"crm_tls_ready || die 'Cutover blocked",
		'nginx -t -c "$release_root/nginx-check.conf"'
	]) {
		assert.ok(
			controller.indexOf(marker) >= 0 && controller.indexOf(marker) < stop,
			marker
		)
	}
	assert.ok(
		controller.indexOf('compose build "$app"') <
			controller.indexOf('candidate_compose run')
	)
	assert.ok(controller.indexOf('if [[ "$mode" == --prepare ]]') < stop)
	assert.match(controller, /mode="\$\{1:---preflight\}"/)
	assert.match(
		controller,
		/Less than 2 GiB available for a serial frontend build/
	)
})

test('rollback and interrupted execution retain previous resources and remove only scoped candidates', () => {
	assert.match(controller, /trap cleanup EXIT/)
	assert.match(controller, /trap 'exit 130' INT/)
	assert.match(controller, /trap 'exit 143' TERM/)
	assert.match(controller, /docker start "\$\{old_ids\[\$app\]\}"/)
	assert.match(controller, /cp "\$release_root\/nginx.before" "\$restore"/)
	assert.match(
		controller,
		/label=com\.docker\.compose\.project=\$candidate_project/
	)
	assert.match(controller, /\{\{len \.Containers\}\}/)
	assert.doesNotMatch(
		controller,
		/docker (?:system|image|volume|builder) prune|compose down|docker rmi|rm -rf/
	)
	assert.doesNotMatch(controller, /compose logs|source "?\$env_file|eval /)
})

test('source, synchronized env, legacy image and infra artifact have immutable release bindings', () => {
	assert.match(controller, /EXPECTED_REVISION:-\}/)
	assert.match(controller, /VERIFIED_CI_REVISION:-\}/)
	assert.match(controller, /FRONTEND_PRODUCTION_ENV_SHA256:-\}/)
	assert.match(controller, /artifacts\/\$infra_revision\/frontend.conf/)
	assert.match(
		controller,
		/sha256:d28d1a696b7d8a5de242eee93cde55d5dd7332312c2393092bce38a339e3fda1/
	)
	assert.match(controller, /source_path=\/app\/\.next\/static/)
	assert.match(controller, /NEXT_PUBLIC_WINCRM_BILLING_ENABLED!=="false"/)
	assert.match(controller, /NEXT_PUBLIC_WINCRM_ENABLED!=="false"/)
	assert.match(controller, /set -o noclobber/)
	assert.match(controller, /exec \{lock_fd\}<>/)
})
