import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const NAMESPACES = ['legacy', 'landing', 'widgets', 'admin-panel', 'crm']
const MAX_FILES = 20_000
const MAX_BYTES = 1024 * 1024 * 1024
const MAX_FILE_BYTES = 128 * 1024 * 1024
const fail = () => {
	throw new Error('Frontend static asset contract failed')
}
const canonicalSha = value =>
	typeof value === 'string' &&
	value.length === 40 &&
	/^[a-f0-9]{40}$/.test(value)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const inspect = target => {
	try {
		return fs.lstatSync(target)
	} catch (error) {
		if (error.code === 'ENOENT') return null
		throw error
	}
}
const assertDirectory = target => {
	const stat = inspect(target)
	if (!stat?.isDirectory() || stat.isSymbolicLink()) fail()
}
const assertRoot = target => {
	if (
		typeof target !== 'string' ||
		!path.isAbsolute(target) ||
		path.parse(target).root === target
	)
		fail()
	assertDirectory(target)
	if (fs.realpathSync(target) !== path.resolve(target)) fail()
	return path.resolve(target)
}
const assertPart = name => {
	if (
		!name ||
		name === '.' ||
		name === '..' ||
		/[\\\u0000-\u001f\u007f]/.test(name) ||
		name.startsWith('.')
	)
		fail()
}
const walkDirectories = (root, relative, create = false) => {
	let current = root
	for (const part of relative.split('/')) {
		assertPart(part)
		current = path.join(current, part)
		const stat = inspect(current)
		if (!stat && create) {
			fs.mkdirSync(current, { mode: 0o755 })
			fs.chmodSync(current, 0o755)
		} else if (!stat) continue
		else {
			assertDirectory(current)
			if ((stat.mode & 0o777) !== 0o755) fail()
		}
	}
	return current
}
const readAsset = (target, consume) => {
	const fd = fs.openSync(
		target,
		fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
	)
	try {
		const before = fs.fstatSync(fd)
		if (
			!before.isFile() ||
			before.nlink !== 1 ||
			before.size > MAX_FILE_BYTES
		)
			fail()
		const buffer = Buffer.alloc(64 * 1024)
		const hash = createHash('sha256')
		let bytes = 0
		let count
		while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
			bytes += count
			if (bytes > MAX_FILE_BYTES) fail()
			const chunk = buffer.subarray(0, count)
			hash.update(chunk)
			consume?.(chunk)
		}
		const after = fs.fstatSync(fd)
		if (
			before.size !== bytes ||
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs
		)
			fail()
		return { bytes, sha256: hash.digest('hex') }
	} finally {
		fs.closeSync(fd)
	}
}
const same = (left, right) =>
	left.bytes === right.bytes && left.sha256 === right.sha256
const syncDirectory = directory => {
	const fd = fs.openSync(directory, fs.constants.O_RDONLY)
	try {
		fs.fsyncSync(fd)
	} finally {
		fs.closeSync(fd)
	}
}
const publishFile = (target, expected, write) => {
	const existing = inspect(target)
	if (existing) {
		if (
			!existing.isFile() ||
			existing.isSymbolicLink() ||
			(existing.mode & 0o777) !== 0o644 ||
			!same(readAsset(target), expected)
		)
			fail()
		return false
	}
	const parent = path.dirname(target)
	const temporary = path.join(parent, `.asset-${randomUUID()}`)
	const fd = fs.openSync(
		temporary,
		fs.constants.O_WRONLY |
			fs.constants.O_CREAT |
			fs.constants.O_EXCL |
			fs.constants.O_NOFOLLOW,
		0o644
	)
	try {
		fs.fchmodSync(fd, 0o644)
		write(fd)
		fs.fsyncSync(fd)
		if (!same(readAsset(temporary), expected)) fail()
		try {
			// link is atomic and cannot replace an existing destination.
			fs.linkSync(temporary, target)
		} catch (error) {
			if (error.code !== 'EEXIST' || !same(readAsset(target), expected))
				fail()
		}
	} finally {
		fs.closeSync(fd)
		fs.unlinkSync(temporary)
	}
	syncDirectory(parent)
	return true
}

// Called only under the frontend deployment lock. Append-only publication:
// failures never remove prior releases, overwrite collisions, or prune assets.
export function publishFrontendStaticAssets({
	source,
	store,
	namespace,
	revision
}) {
	try {
		if (!NAMESPACES.includes(namespace) || !canonicalSha(revision)) fail()
		source = assertRoot(source)
		store = assertRoot(store)
		if (
			source === store ||
			source.startsWith(`${store}${path.sep}`) ||
			store.startsWith(`${source}${path.sep}`)
		)
			fail()
		const files = []
		let total = 0
		const visit = (directory, relative = '') => {
			assertDirectory(directory)
			for (const entry of fs.readdirSync(directory, {
				withFileTypes: true
			})) {
				assertPart(entry.name)
				const name = relative ? `${relative}/${entry.name}` : entry.name
				const target = path.join(directory, entry.name)
				if (entry.isDirectory()) visit(target, name)
				else if (entry.isFile()) {
					const metadata = readAsset(target)
					total += metadata.bytes
					if (files.length >= MAX_FILES || total > MAX_BYTES) fail()
					files.push({ path: name, ...metadata })
				} else fail()
			}
		}
		visit(source)
		if (!files.length) fail()
		files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
		const manifest = Buffer.from(
			JSON.stringify({ schemaVersion: 1, namespace, revision, files }) +
				'\n'
		)
		const namespaceDirectory = walkDirectories(store, namespace)
		const destination = walkDirectories(store, `${namespace}/_next/static`)
		// Check every collision before creating a single public file/directory.
		for (const file of files) {
			const parent = path.posix.dirname(file.path)
			if (parent !== '.') walkDirectories(destination, parent)
			const target = path.join(destination, file.path)
			const existing = inspect(target)
			if (
				existing &&
				(!existing.isFile() ||
					existing.isSymbolicLink() ||
					(existing.mode & 0o777) !== 0o644 ||
					!same(readAsset(target), file))
			)
				fail()
		}
		const manifests = walkDirectories(store, `${namespace}/releases`)
		const manifestPath = path.join(manifests, `${revision}.json`)
		const manifestMetadata = {
			bytes: manifest.length,
			sha256: digest(manifest)
		}
		const existingManifest = inspect(manifestPath)
		if (
			existingManifest &&
			(!existingManifest.isFile() ||
				existingManifest.isSymbolicLink() ||
				(existingManifest.mode & 0o777) !== 0o644 ||
				!same(readAsset(manifestPath), manifestMetadata))
		)
			fail()
		walkDirectories(store, `${namespace}/_next/static`, true)
		walkDirectories(store, `${namespace}/releases`, true)
		let added = 0
		for (const file of files) {
			const parent = path.posix.dirname(file.path)
			if (parent !== '.') walkDirectories(destination, parent, true)
			if (
				publishFile(path.join(destination, file.path), file, fd => {
					const actual = readAsset(path.join(source, file.path), bytes =>
						fs.writeFileSync(fd, bytes)
					)
					if (!same(actual, file)) fail()
				})
			)
				added += 1
		}
		publishFile(manifestPath, manifestMetadata, fd =>
			fs.writeFileSync(fd, manifest)
		)
		syncDirectory(namespaceDirectory)
		return {
			schemaVersion: 1,
			namespace,
			revision,
			files: files.length,
			added,
			bytes: total,
			manifestSha256: manifestMetadata.sha256
		}
	} catch {
		return fail()
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		if (process.argv.length !== 4) fail()
		const result = publishFrontendStaticAssets({
			source: '/source',
			store: '/assets',
			namespace: process.argv[2],
			revision: process.argv[3]
		})
		console.log(JSON.stringify(result))
	} catch {
		console.error('Frontend static asset publication refused')
		process.exitCode = 1
	}
}
