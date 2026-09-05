import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
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
	const finalEmptyGuard = controller.lastIndexOf(
		'\nassert_release_project_empty\n'
	)
	assert.ok(
		assets < prepareExit &&
			prepareExit < tls &&
			tls < stopCandidates &&
			stopCandidates < cutover
	)
	assert.ok(stopCandidates < finalEmptyGuard && finalEmptyGuard < cutover)
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

test('rollback protects its own execution from repeated termination and only cleans empty owned candidate networks', () => {
	const cleanup = controller.slice(
		controller.indexOf('cleanup() {'),
		controller.indexOf('trap cleanup EXIT')
	)
	assert.ok(
		cleanup.indexOf("trap '' INT TERM HUP") <
			cleanup.indexOf('docker stop')
	)
	assert.match(cleanup, /docker start "\$\{old_ids\[\$app\]\}"/)
	assert.match(
		cleanup,
		/\{\{index \.Labels "com\.docker\.compose\.project"\}\}/
	)
	assert.match(
		cleanup,
		/"\$candidate_project" &&[\s\S]*?\{\{len \.Containers\}\}/
	)
	assert.doesNotMatch(
		cleanup,
		/network prune|compose down|volume rm|docker rmi/
	)
})
