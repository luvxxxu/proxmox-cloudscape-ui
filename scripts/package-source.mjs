import { createReadStream, constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archiveName = 'proxmox-cloudscape-ui-source.tar.gz';
const excludedDirectories = new Set([
  '.git', 'node_modules', '.next', 'build', 'out', 'coverage', 'test-results',
  'playwright-report', 'data', '.ssh', '.aws', '.vercel', '.idea', '__macosx',
]);

function excluded(name) {
  const parts = name.split('/');
  const basename = parts.at(-1).toLowerCase();
  return parts.some(part => excludedDirectories.has(part.toLowerCase()))
    || parts.some(part => part.toLowerCase().startsWith('.env')) && name !== '.env.local.example'
    || name === 'deploy/certs' || name.startsWith('deploy/certs/')
    || /\.(?:pem|key|crt|cer|der|p12|pfx|p7b|p7c|csr|jks|keystore)$/i.test(basename)
    || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|privkey|privatekey|private-key)(?:\.|$)/i.test(basename)
    || ['.netrc', '.npmrc', '.yarnrc', '.ds_store', 'auto-update.json'].includes(basename)
    || basename.startsWith('._')
    || basename.endsWith('.tsbuildinfo');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repository, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  return result.stdout;
}

async function ensureRegularFile(name) {
  if (!name || path.posix.isAbsolute(name) || /[\x00-\x1f\x7f\\]/.test(name) || name.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('Git returned an unsafe source file path.');
  }
  const parts = name.split('/');
  for (let index = 1; index <= parts.length; index += 1) {
    let stat;
    try { stat = await lstat(path.join(repository, ...parts.slice(0, index))); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Refusing to package a symbolic link: ${name}`);
    if (index === parts.length && !stat.isFile()) throw new Error(`Source entry is not a regular file: ${name}`);
    if (index < parts.length && !stat.isDirectory()) throw new Error(`Source parent is not a directory: ${name}`);
  }
  return true;
}

async function assertOutputPath(filename, directory = false) {
  let stat;
  try { stat = await lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`Unsafe output path: ${filename}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(`Usage: bun run package:source\nCreates build/${archiveName} and its .sha256 checksum from the current Git working tree.`);
    return;
  }
  if (args.length) throw new Error('No output override is supported. Run bun run package:source without arguments.');
  let gitRoot;
  try { gitRoot = run('git', ['rev-parse', '--show-toplevel']).trim(); }
  catch { throw new Error('Source packaging requires a Git checkout. An extracted source archive cannot be repackaged.'); }
  if (await realpath(gitRoot) !== await realpath(repository)) throw new Error('Run this script from its original repository, not a nested or extracted directory.');

  const listed = [...new Set(run('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort();
  const files = [];
  for (const name of listed) {
    if (!excluded(name) && await ensureRegularFile(name)) files.push(name);
  }
  for (const required of ['package.json', 'bun.lock', '.env.local.example', 'scripts/package-source.mjs']) {
    if (!files.includes(required)) throw new Error(`Required deployment source is missing or ignored: ${required}`);
  }
  if (!files.some(name => name.startsWith('app/')) || !files.some(name => name.startsWith('server/')) || !files.some(name => name.startsWith('deploy/'))) {
    throw new Error('The app, server, and deploy source directories must be present.');
  }

  const outputDirectory = path.join(repository, 'build');
  await assertOutputPath(outputDirectory, true);
  await mkdir(outputDirectory, { recursive: true });
  const archivePath = path.join(outputDirectory, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  await assertOutputPath(archivePath);
  await assertOutputPath(checksumPath);
  const staging = await mkdtemp(path.join(outputDirectory, '.source-package-'));
  try {
    // Snapshot regular files before tar runs: archives never traverse symlinks or
    // recursively include unlisted files that appear during the packaging step.
    const source = path.join(staging, 'source');
    await mkdir(source);
    for (const name of files) {
      const handle = await open(path.join(repository, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error(`Source changed while packaging: ${name}`);
        const destination = path.join(source, name);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, await handle.readFile(), { mode: stat.mode & 0o777 });
      } finally { await handle.close(); }
    }
    const manifest = path.join(staging, 'files.list');
    await writeFile(manifest, files.map(name => `./${name}\0`).join(''));
    const temporaryArchive = path.join(staging, archiveName);
    // macOS can attach provenance even to newly created staging files. Filter
    // metadata while archiving; never strip attributes or ACLs from source files.
    const metadataOptions = ['--no-xattrs', '--no-acls'];
    if (/bsdtar/i.test(run('tar', ['--version']))) metadataOptions.push('--no-fflags', '--disable-copyfile');
    run('tar', ['-czf', temporaryArchive, '-C', source, ...metadataOptions, '--no-recursion', '--null', '-T', manifest], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(temporaryArchive)) digest.update(chunk);
    const checksum = `${digest.digest('hex')}  ${archiveName}\n`;
    const temporaryChecksum = path.join(staging, `${archiveName}.sha256`);
    await writeFile(temporaryChecksum, checksum);
    // Recheck destinations before replacing the previous archive atomically.
    await assertOutputPath(outputDirectory, true);
    await assertOutputPath(archivePath);
    await assertOutputPath(checksumPath);
    await rename(temporaryArchive, archivePath);
    await rename(temporaryChecksum, checksumPath);
    console.log(`Packaged ${files.length} source files: ${archivePath}\nChecksum: ${checksumPath}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

await main().catch(error => { console.error(`Source packaging failed: ${error.message}`); process.exitCode = 1; });
