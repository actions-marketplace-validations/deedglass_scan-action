// Downloads the deedglass release archive and checks it against checksums/<version>.txt, committed
// in this action repo when the action is released. A checksum fetched at run time is never used.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const version = process.env.DG_VERSION ?? '';
const actionPath = process.env.DG_ACTION_PATH ?? '.';
const tmp = process.env.RUNNER_TEMP ?? '/tmp';
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
  console.error(`✕ version "${version}" isn't a release version like 0.1.0.`);
  process.exit(1);
}
const os = { Linux: 'linux', macOS: 'darwin' }[process.env.RUNNER_OS ?? ''] ?? process.platform.replace('win32', 'windows');
const arch = { X64: 'amd64', ARM64: 'arm64' }[process.env.RUNNER_ARCH ?? ''] ?? (process.arch === 'x64' ? 'amd64' : process.arch);
const name = `deedglass_${version}_${os}_${arch}.tar.gz`;
const sums = join(actionPath, 'checksums', `${version}.txt`);
if (!existsSync(sums)) {
  console.error(`✕ This action has no checksums for deedglass ${version}. Use a version listed in checksums/, or update the action.`);
  process.exit(1);
}
const want = readFileSync(sums, 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[1] === name)?.[0];
if (!want || !/^[0-9a-f]{64}$/.test(want)) {
  console.error(`✕ checksums/${version}.txt has no line for ${name}.`);
  process.exit(1);
}
const dir = join(tmp, 'deedglass');
mkdirSync(join(dir, 'bin'), { recursive: true });
const archive = join(dir, name);
execFileSync('curl', ['--proto', '=https', '--tlsv1.2', '--fail', '--silent', '--show-error', '--location', '--max-time', '60', '-o', archive,
  `https://github.com/deedglass/deedglass/releases/download/v${version}/${name}`], { stdio: 'inherit' });
const got = createHash('sha256').update(readFileSync(archive)).digest('hex');
if (got !== want) {
  console.error(`✕ ${name} doesn't match its checksum (got ${got}). Nothing was run.`);
  process.exit(1);
}
execFileSync('tar', ['-xzf', archive, '-C', join(dir, 'bin'), 'deedglass'], { stdio: 'inherit' });
chmodSync(join(dir, 'bin', 'deedglass'), 0o755);
console.log(`✓ deedglass ${version} · ${name} · sha256 checked`);
