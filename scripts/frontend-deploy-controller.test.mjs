import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const controller = readFileSync(
	new URL('./deploy-production.sh', import.meta.url),
	'utf8'
)
const workflow = readFileSync(
	new URL('../.github/workflows/deploy-production.yml', import.meta.url),
	'utf8'
)
const ciScript = workflow
	.match(/node --input-type=module <<'NODE'\n([\s\S]+?)\n\s+NODE/)[1]
	.replace(/^\s*import \{ appendFileSync \} from 'node:fs';\s*/m, '')
const AsyncFunction = Object.getPrototypeOf(
	async function () {}
).constructor
const runCiGate = new AsyncFunction(
	'process',
	'fetch',
	'appendFileSync',
	'console',
	ciScript
)
const revision = 'a'.repeat(40)

test('actual Compose validator requires paid UI only in CRM/Widgets and preserves all other build/runtime bindings', () => {
	const source = controller.match(
		/compose config --format json 2>\/dev\/null \| node_validate '([\s\S]+?)\n' \|\| die 'Frontend-only Compose/
	)[1]
	const validate = new Function('require', 'process', source)
	const args = {
		APP_REVISION: revision,
		NEXT_PUBLIC_MODE: 'production',
		NEXT_PUBLIC_SITE_URL: 'https://winwidget.ru',
		NEXT_PUBLIC_PRODUCTION_HOST: 'https://api.winwidget.ru',
		NEXT_PUBLIC_WIDGETS_HOST: '',
		NEXT_PUBLIC_API_URL: 'https://api.winwidget.ru/api/v1',
		NEXT_PUBLIC_RECAPTCHA_SITE_KEY: 'synthetic-public-site-key',
		NEXT_PUBLIC_RECAPTCHA_HOST: 'https://www.recaptcha.net',
		NEXT_PUBLIC_APP_URL: 'https://crm.winwidget.ru',
		NEXT_PUBLIC_MAIN_APP_URL: 'https://winwidget.ru',
		NEXT_PUBLIC_WINCRM_ENABLED: 'true'
	}
	const runtime = {
		HOSTNAME: '0.0.0.0',
		NEXT_TELEMETRY_DISABLED: '1',
		NODE_ENV: 'production',
		PORT: '3000'
	}
	const auth = {
		JWT_AUDIENCE: 'https://api.winwidget.ru',
		JWT_ISSUER: 'https://api.winwidget.ru/auth',
		JWT_JWKS_URL:
			'https://api.winwidget.ru/api/v1/auth/.well-known/jwks.json',
		JWT_MAX_TOKEN_LIFETIME_SECONDS: '900',
		JWT_CLOCK_TOLERANCE_SECONDS: '5'
	}
	const services = Object.fromEntries(
		Object.entries({
			landing: 3000,
			crm: 3001,
			widgets: 3002,
			'admin-panel': 3003
		}).map(([app, port]) => [
			app,
			{
				image: `winwidget-${app}:git-${revision}`,
				build: {
					args: {
						...args,
						FRONTEND_APP: app,
						NEXT_PUBLIC_WINCRM_BILLING_ENABLED:
							app === 'crm' || app === 'widgets' ? 'true' : 'false'
					}
				},
				environment: {
					...runtime,
					...(app === 'widgets' || app === 'admin-panel' ? auth : {})
				},
				ports: [
					{ host_ip: '127.0.0.1', published: String(port), target: 3000 }
				]
			}
		])
	)
	const verify = input =>
		validate(
			name => {
				assert.equal(name, 'node:fs')
				return {
					readFileSync: fd => {
						assert.equal(fd, 0)
						return JSON.stringify(input)
					}
				}
			},
			{
				exit: () => {
					throw new Error('rejected')
				}
			}
		)
	assert.doesNotThrow(() => verify({ services }))
	for (const app of Object.keys(services)) {
		for (const value of [
			undefined,
			'TRUE',
			'1',
			app === 'crm' || app === 'widgets' ? 'false' : 'true'
		]) {
			const altered = structuredClone(services)
			altered[app].build.args.NEXT_PUBLIC_WINCRM_BILLING_ENABLED = value
			assert.throws(
				() => verify({ services: altered }),
				/rejected/,
				`${app}: ${value}`
			)
		}
	}
	const widgetsPayment = structuredClone(services)
	widgetsPayment.widgets.build.args.PAYMENT_ENABLED = 'false'
	assert.throws(() => verify({ services: widgetsPayment }), /rejected/)
	const runtimeFlag = structuredClone(services)
	runtimeFlag.crm.environment.NEXT_PUBLIC_WINCRM_BILLING_ENABLED = 'true'
	assert.throws(() => verify({ services: runtimeFlag }), /rejected/)
})
const repository = 'synthetic/frontends'
const jobNames = [
	'Workspace contracts and shared package',
	'Verify landing',
	'Verify widgets',
	'Verify admin-panel',
	'Verify crm'
]
const greenRun = (id = 10) => ({
	id,
	head_sha: revision,
	head_repository: { full_name: repository },
	event: 'push',
	status: 'completed',
	conclusion: 'success'
})
const greenJobs = () => ({
	total_count: 5,
	jobs: jobNames.map(name => ({
		name,
		status: 'completed',
		conclusion: 'success'
	}))
})
async function verifyCi({
	runs = [greenRun()],
	jobs = greenJobs(),
	sha = revision,
	httpOk = true
} = {}) {
	const calls = []
	const outputs = []
	await runCiGate(
		{
			env: {
				REPOSITORY: repository,
				REVISION: sha,
				GH_TOKEN: 'synthetic-no-access-token',
				GITHUB_API_URL: 'https://github-api.invalid',
				GITHUB_OUTPUT: 'synthetic-output'
			}
		},
		async (url, options) => {
			calls.push({ url, options })
			assert.equal(options.redirect, 'error')
			assert.ok(options.signal instanceof AbortSignal)
			return {
				ok: httpOk,
				json: async () =>
					url.includes('/jobs?') ? jobs : { workflow_runs: runs }
			}
		},
		(path, value) => {
			assert.equal(path, 'synthetic-output')
			outputs.push(value)
		},
		{ log: () => {} }
	)
	return { calls, outputs }
}

test('actual deployment CI admission executes only against the exact SHA and all five green jobs', async () => {
	const { calls, outputs } = await verifyCi()
	assert.equal(calls.length, 2)
	assert.ok(
		calls[0].url.endsWith(
			`/actions/workflows/ci.yml/runs?head_sha=${revision}&per_page=100`
		)
	)
	assert.ok(
		calls[1].url.endsWith(
			'/actions/runs/10/jobs?filter=latest&per_page=100'
		)
	)
	assert.deepEqual(outputs, ['run-id=10\n'])
})

test('a newer failed or pending exact-SHA CI cannot fall back to an older successful run', async () => {
	for (const patch of [
		{ status: 'in_progress', conclusion: null },
		{ status: 'queued', conclusion: null },
		{ conclusion: 'failure' },
		{ conclusion: 'cancelled' },
		{ conclusion: 'skipped' }
	])
		await assert.rejects(
			verifyCi({ runs: [greenRun(10), { ...greenRun(11), ...patch }] }),
			/not green/
		)
})

test('foreign repository, wrong SHA, manual verification and absent evidence never authorize deployment', async () => {
	for (const patch of [
		{ head_repository: { full_name: 'foreign/frontends' } },
		{ head_sha: 'b'.repeat(40) },
		{ event: 'workflow_dispatch' },
		{ head_repository: null }
	])
		await assert.rejects(
			verifyCi({ runs: [{ ...greenRun(), ...patch }] }),
			/not green/
		)
	await assert.rejects(verifyCi({ runs: [] }), /not green/)
	await assert.rejects(verifyCi({ sha: 'prod' }), /Invalid immutable/)
	await assert.rejects(verifyCi({ httpOk: false }), /unavailable/)
})

test('missing, duplicate, extra, skipped and failed verification jobs fail closed', async () => {
	const missing = greenJobs()
	missing.jobs.pop()
	missing.total_count--
	const duplicate = greenJobs()
	duplicate.jobs[4].name = duplicate.jobs[3].name
	const extra = greenJobs()
	extra.jobs.push({
		name: 'Unreviewed extra job',
		status: 'completed',
		conclusion: 'success'
	})
	extra.total_count++
	const skipped = greenJobs()
	skipped.jobs[3].conclusion = 'skipped'
	const failed = greenJobs()
	failed.jobs[0].conclusion = 'failure'
	const pending = greenJobs()
	pending.jobs[1].status = 'in_progress'
	for (const jobs of [
		missing,
		duplicate,
		extra,
		skipped,
		failed,
		pending
	]) {
		await assert.rejects(verifyCi({ jobs }), /Not all four/)
	}
})

const emptyProjectGuard = controller.match(
	/assert_release_project_empty\(\) \{\n[\s\S]+?\n\}/
)[0]
test('actual release inventory guard rejects occupied projects and failed Docker inspection before mutation', () => {
	for (const result of ['empty', 'occupied', 'error']) {
		const script = `set -euo pipefail
project=synthetic-release
die() { printf '%s\\n' "$1" >&2; exit 1; }
docker() {
  [[ "$*" == 'ps --all --filter label=com.docker.compose.project=synthetic-release --quiet' ]] || exit 90
  case '${result}' in empty) return 0 ;; occupied) printf '%s\\n' synthetic-owned-id ;; error) return 1 ;; esac
}
${emptyProjectGuard}
assert_release_project_empty
printf '%s\\n' admitted`
		const output = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
		assert.equal(output.error, undefined)
		assert.equal(output.status, result === 'empty' ? 0 : 1)
		assert.equal(output.stdout.includes('admitted'), result === 'empty')
	}
})

test('candidate and live runtimes never overlap beyond the verified four-candidate memory probe', () => {
	const cutover = controller.indexOf('cutover_started=true\n')
	const stopCandidates = controller.indexOf(
		"die 'A verified candidate could not stop"
	)
	const tls = controller.indexOf("crm_tls_ready || die 'Cutover blocked")
	const assets = controller.indexOf(
		'/controller.mjs "$namespace" "$source_revision"'
	)
	const prepareExit = controller.indexOf('if [[ "$mode" == --prepare ]]')
	const candidateCleanup = controller.indexOf(
		'\ncleanup_candidates true ||'
	)
	const staging = controller.indexOf('\nprepare_staged_release ||')
	const finalInventory = controller.indexOf('\nverify_staged_inventory ||')
	assert.ok(
		assets < prepareExit &&
			prepareExit < tls &&
			tls < stopCandidates &&
			stopCandidates < cutover
	)
	assert.ok(
		stopCandidates < candidateCleanup && candidateCleanup < staging
	)
	assert.ok(staging < finalInventory && finalInventory < cutover)
	assert.ok(
		controller.indexOf('assert_release_project_empty\n') <
			controller.indexOf('compose build "$app"')
	)
	assert.match(
		controller.slice(tls, cutover),
		/Candidate identity changed before controlled shutdown/
	)
	assert.match(
		controller.slice(tls, cutover),
		/available_kib < 512 \* 1024/
	)
	assert.match(controller.slice(tls, cutover), /\$\{images\[\$app\]\}/)
})

test('sticky lock identity and canonical checkout checks precede production git mutations', () => {
	assert.match(controller, /stat -c '%u:%g:%a' \/run\/lock\)" == 0:0:1777/)
	assert.match(workflow, /stat -c '%u:%g:%a' \/run\/lock\)" == 0:0:1777/)
	const fetch = workflow.indexOf('fetch --no-tags origin prod')
	assert.ok(workflow.indexOf('Unsafe frontend checkout metadata') < fetch)
	assert.ok(workflow.indexOf('Writable frontend checkout refused') < fetch)
	assert.ok(workflow.indexOf('flock -n 9') < fetch)
	assert.match(
		workflow,
		/git -C "\$checkout_path" merge --ff-only FETCH_HEAD/
	)
	assert.doesNotMatch(workflow, /reset --hard|checkout --|git clean/)
})

test('rollback protects its own execution and network cleanup checks stopped container references', () => {
	const cleanup = controller.slice(
		controller.indexOf('cleanup() {'),
		controller.indexOf('trap cleanup EXIT')
	)
	assert.ok(
		cleanup.indexOf("trap '' INT TERM HUP") <
			cleanup.indexOf('docker stop')
	)
	assert.match(cleanup, /docker start "\$\{old_ids\[\$app\]\}"/)
	assert.match(cleanup, /cleanup_staged_release \|\| cleanup_failed=true/)
	assert.match(cleanup, /cleanup_candidates \|\| cleanup_failed=true/)
	const networkCleanup = controller.slice(
		controller.indexOf('remove_unreferenced_project_network() {'),
		controller.indexOf('cleanup_candidates() {')
	)
	assert.match(
		networkCleanup,
		/\{\{index \.Labels "com\.docker\.compose\.project"\}\}/
	)
	assert.match(networkCleanup, /\{\{len \.Containers\}\}/)
	assert.match(networkCleanup, /docker ps --all --no-trunc --quiet/)
	assert.match(networkCleanup, /\.HostConfig.NetworkMode/)
	assert.match(networkCleanup, /\.NetworkSettings.Networks/)
	assert.doesNotMatch(
		controller,
		/network prune|compose down|volume rm|docker rmi/
	)
})

// Run the controller's actual preparation/cutover fragment and EXIT handler.
// The Docker CLI fixture persists only synthetic metadata; no daemon is used.
const stageHelpers = controller.slice(
	controller.indexOf('remove_unreferenced_project_network() {'),
	controller.indexOf('trap cleanup EXIT')
)
const stageCutover = controller.slice(
	controller.indexOf('\ncleanup_candidates true ||'),
	controller.indexOf('\n: >"$release_root/containers"')
)
const fixtureApps = ['landing', 'crm', 'widgets', 'admin-panel']
const fixtureId = n => n.toString(16).padStart(64, '0')
const fixtureProject = `winwidget-frontends-${revision}`
const fixtureCandidate = `winwidget-candidate-${revision}`

function dockerFixture() {
	const fs = require('node:fs')
	const statePath = process.env.DOCKER_STATE
	const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
	const args = process.argv.slice(2)
	const id = n => n.toString(16).padStart(64, '0')
	const save = () => fs.writeFileSync(statePath, JSON.stringify(state))
	const done = (output = '', status = 0) => {
		save()
		if (output) process.stdout.write(`${output}\n`)
		process.exit(status)
	}
	state.calls.push(args)
	const filter = args[args.indexOf('--filter') + 1]
	if (args[0] === 'compose-create') {
		if (
			args.slice(1).join(' ') !==
			'create --no-build --pull never --no-recreate landing crm widgets admin-panel'
		)
			done('', 90)
		if (state.networks.some(n => n.project === state.candidate))
			done('', 91)
		if (state.scenario === 'network-failure')
			done('all predefined address pools have been fully subnetted', 1)
		state.networks.push({ id: id(202), project: state.project })
		if (state.scenario === 'network-only-failure') done('', 1)
		const count = state.scenario === 'partial-create' ? 2 : 4
		for (let i = 0; i < count; i++) {
			const container = {
				id: id(30 + i),
				project: state.project,
				service: state.apps[i],
				image: state.images[i],
				revision: state.revision,
				status: 'created',
				running: false,
				pid: 0,
				restarts: 0,
				port: 3000 + i,
				host: '127.0.0.1',
				network: `${state.project}_default`
			}
			if (i === 1) {
				if (state.scenario === 'foreign-image')
					container.image = `sha256:${id(999)}`
				if (state.scenario === 'running-container') {
					container.status = 'running'
					container.running = true
					container.pid = 17
				}
				if (state.scenario === 'public-port') container.host = '0.0.0.0'
				if (state.scenario === 'duplicate-service')
					container.service = 'landing'
			}
			state.containers.push(container)
		}
		done('', state.scenario === 'partial-create' ? 1 : 0)
	}
	if (args[0] === 'replace-staged') {
		const container = state.containers.find(c => c.id === id(31))
		container.id = id(99)
		done()
	}
	if (args[0] === 'ps') {
		if (state.scenario === 'inventory-error' && !args.includes('--filter'))
			done('', 1)
		done(
			state.containers
				.filter(
					c =>
						!args.includes('--filter') ||
						c.project === filter.split('=')[2]
				)
				.map(c => c.id)
				.join('\n')
		)
	}
	if (args[0] === 'network') {
		if (args[1] === 'ls')
			done(
				state.networks
					.filter(n => `name=^${n.project}_default$` === filter)
					.map(n => n.id)
					.join('\n')
			)
		const network = state.networks.find(n => n.id === args.at(-1))
		if (!network) done('', 1)
		if (args[1] === 'inspect')
			done(`${network.project}_default ${network.project} default 0`)
		if (args[1] === 'rm') {
			if (
				state.containers.some(
					c => c.network === `${network.project}_default`
				)
			)
				done('', 1)
			state.networks = state.networks.filter(n => n !== network)
			done()
		}
	}
	if (args[0] === 'inspect') {
		const container = state.containers.find(c => c.id === args.at(-1))
		if (!container) done('', 1)
		const format = args[args.indexOf('--format') + 1]
		if (format.includes('.HostConfig.NetworkMode')) done(container.network)
		if (format.includes('.HostConfig.PortBindings'))
			done(`1 1 ${container.host} ${container.port}`)
		if (format === '{{.State.Status}} {{.State.Running}}')
			done(`${container.status} ${container.running}`)
		if (format === '{{index .Config.Labels "com.docker.compose.service"}}')
			done(container.service)
		const identity = `${container.project} ${container.service} ${container.image} ${container.revision}`
		if (format.includes('.Name'))
			done(
				`${identity} /${container.project}-${container.service}-1 ${container.status} ${container.running} ${container.pid} ${container.restarts}`
			)
		if (format.includes('org.opencontainers.image.revision'))
			done(identity)
		done('', 92)
	}
	if (args[0] === 'rm') {
		const container = state.containers.find(c => c.id === args.at(-1))
		if (!container || (container.running && !args.includes('-f')))
			done('', 1)
		state.containers = state.containers.filter(c => c !== container)
		done()
	}
	if (args[0] === 'stop' || args[0] === 'start') {
		if (
			args[0] === 'start' &&
			state.scenario === 'start-failure' &&
			args.includes(id(30))
		) {
			state.containers.find(c => c.id === id(30)).running = true
			done('', 1)
		}
		for (const cid of args.slice(1)) {
			const container = state.containers.find(c => c.id === cid)
			if (!container) done('', 1)
			container.running = args[0] === 'start'
			container.status = container.running ? 'running' : 'exited'
		}
		done()
	}
	if (['cp', 'chmod', 'probe'].includes(args[0])) done()
	done('', 93)
}

function runStageFixture(scenario = 'success', fragment = stageCutover) {
	const directory = mkdtempSync(join(tmpdir(), 'frontend-stage-test-'))
	try {
		const images = fixtureApps.map(
			(_, i) => `sha256:${fixtureId(100 + i)}`
		)
		const state = {
			scenario,
			calls: [],
			apps: fixtureApps,
			revision,
			project: fixtureProject,
			candidate: fixtureCandidate,
			images,
			networks: [
				{ id: fixtureId(200), project: 'old' },
				{ id: fixtureId(201), project: fixtureCandidate }
			],
			containers: fixtureApps.flatMap((service, i) => [
				{
					id: fixtureId(10 + i),
					project: 'old',
					service,
					running: true,
					network: 'old_default'
				},
				{
					id: fixtureId(20 + i),
					project: fixtureCandidate,
					service,
					image: images[i],
					revision,
					status: 'exited',
					running: false,
					network: `${fixtureCandidate}_default`
				}
			])
		}
		if (scenario === 'stopped-network-reference')
			state.containers.push({
				id: fixtureId(90),
				project: 'prior',
				running: false,
				network: `${fixtureCandidate}_default`
			})
		if (scenario === 'occupied-release')
			state.containers.push({
				id: fixtureId(90),
				project: fixtureProject,
				running: false,
				network: 'prior_default'
			})
		if (scenario === 'existing-release-network')
			state.networks.push({ id: fixtureId(202), project: fixtureProject })
		const statePath = join(directory, 'state.json')
		const shimPath = join(directory, 'docker.cjs')
		writeFileSync(statePath, JSON.stringify(state))
		writeFileSync(
			shimPath,
			`${dockerFixture.toString()}\ndockerFixture()\n`
		)
		const script = `set -eo pipefail
revision=${revision}
project=${fixtureProject}
candidate_project=${fixtureCandidate}
apps=(landing crm widgets admin-panel)
stage_images=(${images.join(' ')})
candidate_slots=(${fixtureApps.map((_, i) => fixtureId(20 + i)).join(' ')})
old_ids=(${fixtureApps.map((_, i) => fixtureId(10 + i)).join(' ')})
staged_ids=()
stage_started=false
stage_inventory_collected=false
candidate_network_owned=true
cutover_started=false
completed=false
current_pointer_written=false
prior_revision=legacy
release_root="$FIXTURE_ROOT"
nginx_target=synthetic-nginx
die() { printf '%s\\n' "$1" >&2; exit 1; }
docker() { "$FIXTURE_NODE" "$FIXTURE_DOCKER" "$@"; }
compose() { docker compose-create "$@"; }
awk() { printf '%s\\n' 1048576; }
cp() { docker cp "$@"; }
chmod() { docker chmod "$@"; }
curl() { docker probe "$@"; }
${emptyProjectGuard}
${stageHelpers}
trap cleanup EXIT
${fragment}
completed=true
`
		const output = spawnSync('bash', ['-c', script], {
			encoding: 'utf8',
			timeout: 30000,
			env: {
				...process.env,
				DOCKER_STATE: statePath,
				FIXTURE_ROOT: directory,
				FIXTURE_NODE: process.execPath,
				FIXTURE_DOCKER: shimPath
			}
		})
		assert.equal(output.error, undefined)
		return {
			...output,
			state: JSON.parse(readFileSync(statePath, 'utf8'))
		}
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

const mutations = state =>
	state.calls.filter(
		args =>
			['start', 'stop', 'rm', 'cp', 'chmod'].includes(args[0]) ||
			args.slice(0, 2).join(' ') === 'network rm'
	)
function assertOldUntouched(result) {
	assert.equal(result.status, 1, result.stderr)
	for (const cid of fixtureApps.map((_, i) => fixtureId(10 + i))) {
		assert.equal(
			result.state.containers.find(c => c.id === cid)?.running,
			true
		)
		assert.ok(!mutations(result.state).some(args => args.includes(cid)))
	}
	assert.ok(
		!result.state.calls.some(args =>
			['cp', 'chmod', 'start', 'stop'].includes(args[0])
		)
	)
}

test('actual cutover frees the candidate subnet and creates all four stopped containers before stopping old runtime', () => {
	const result = runStageFixture()
	assert.equal(result.status, 0, result.stderr)
	const calls = result.state.calls
	const create = calls.findIndex(args => args[0] === 'compose-create')
	const networkRemoval = calls.findIndex(
		args => args.slice(0, 2).join(' ') === 'network rm'
	)
	const firstStop = calls.findIndex(args => args[0] === 'stop')
	assert.ok(
		networkRemoval >= 0 && networkRemoval < create && create < firstStop
	)
	assert.deepEqual(
		calls.filter(args => args[0] === 'start'),
		[['start', ...fixtureApps.map((_, i) => fixtureId(30 + i))]]
	)
	assert.equal(
		result.state.containers.filter(c => c.project === fixtureCandidate)
			.length,
		0
	)
})

test('actual network allocation and partial-create failures clean preparation only and never reach cutover', () => {
	for (const scenario of [
		'network-failure',
		'network-only-failure',
		'partial-create'
	]) {
		const result = runStageFixture(scenario)
		assertOldUntouched(result)
		assert.match(result.stderr, /preparation failed before cutover/)
		assert.equal(
			result.state.containers.filter(c => c.project === fixtureProject)
				.length,
			0
		)
		assert.ok(
			!result.state.networks.some(n => n.project === fixtureProject)
		)
		assert.ok(
			result.state.calls
				.filter(args => args[0] === 'rm')
				.every(args => !args.includes('-f'))
		)
	}
})

test('actual staging rejects foreign images, running containers, unsafe ports and duplicate services without removing those objects', () => {
	for (const scenario of [
		'foreign-image',
		'running-container',
		'public-port',
		'duplicate-service'
	]) {
		const result = runStageFixture(scenario)
		assertOldUntouched(result)
		assert.ok(
			result.state.containers.some(c => c.id === fixtureId(31)),
			scenario
		)
		assert.ok(
			!mutations(result.state).some(args => args.includes(fixtureId(31))),
			scenario
		)
		assert.ok(
			result.state.networks.some(n => n.project === fixtureProject)
		)
	}
})

test('actual candidate cleanup fails closed for stopped network references and failed global inventory', () => {
	for (const scenario of [
		'stopped-network-reference',
		'inventory-error'
	]) {
		const result = runStageFixture(scenario)
		assertOldUntouched(result)
		assert.ok(
			!result.state.calls.some(args => args[0] === 'compose-create')
		)
		assert.ok(
			result.state.networks.some(n => n.project === fixtureCandidate)
		)
	}
})

test('actual staging never adopts prior release containers or a pre-existing release network', () => {
	for (const scenario of [
		'occupied-release',
		'existing-release-network'
	]) {
		const result = runStageFixture(scenario)
		assertOldUntouched(result)
		assert.ok(
			!result.state.calls.some(args => args[0] === 'compose-create')
		)
		assert.ok(
			!mutations(result.state).some(
				args =>
					args.includes(fixtureId(90)) || args.includes(fixtureId(202))
			)
		)
	}
})

test('actual cleanup keeps the staged receipt and never adopts a replacement ID after preparation', () => {
	const result = runStageFixture(
		'success',
		`
cleanup_candidates true || die candidate
prepare_staged_release || die staging
docker replace-staged
verify_staged_inventory && die 'unexpected acceptance'
die 'injected identity replacement'
`
	)
	assertOldUntouched(result)
	assert.ok(result.state.containers.some(c => c.id === fixtureId(99)))
	assert.ok(
		!mutations(result.state).some(args => args.includes(fixtureId(99)))
	)
	assert.match(result.stderr, /Preparation cleanup incomplete/)
})

test('actual startup failure stops only the staged IDs and restarts the exact prior runtime', () => {
	const result = runStageFixture('start-failure')
	assert.equal(result.status, 1, result.stderr)
	assert.match(
		result.stderr,
		/Previous frontend containers and Nginx configuration restored/
	)
	for (const cid of fixtureApps.map((_, i) => fixtureId(10 + i))) {
		assert.equal(
			result.state.containers.find(c => c.id === cid)?.running,
			true
		)
		assert.ok(
			!result.state.calls.some(
				args => args[0] === 'rm' && args.includes(cid)
			)
		)
	}
	for (const cid of fixtureApps.map((_, i) => fixtureId(30 + i))) {
		assert.equal(
			result.state.containers.find(c => c.id === cid)?.running,
			false
		)
		assert.ok(
			result.state.calls.some(
				args => args[0] === 'stop' && args.includes(cid)
			)
		)
		assert.ok(
			!result.state.calls.some(
				args => args[0] === 'rm' && args.includes(cid)
			)
		)
	}
	assert.deepEqual(
		result.state.calls.filter(args => args[0] === 'start').slice(1),
		fixtureApps.map((_, i) => ['start', fixtureId(10 + i)])
	)
})
