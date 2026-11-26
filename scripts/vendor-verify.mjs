/**
 * Verifies that `vendor/npm-cache` covers every package npm would install on the
 * platforms this project supports, and that each archive matches its lockfile
 * integrity hash.
 *
 * Exits non-zero on any gap, so CI can assert the vendor store is complete rather
 * than discovering a hole during an offline install.
 *
 * Usage:
 *   node scripts/vendor-verify.mjs
 *   node scripts/vendor-verify.mjs --platform darwin-arm64   # check another target
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE_DIR = path.join(ROOT, 'vendor', 'npm-cache', '_cacache');
const CACHE_KEY_PREFIX = 'make-fetch-happen:request-cache:';
const require = createRequire(import.meta.url);
const lock = require(path.join(ROOT, 'package-lock.json'));

/** Release target + CI runners (see .github/workflows/release.yml and ci.yml). */
const DEFAULT_PLATFORMS = ['win32-x64', 'linux-x64'];

const platformArgIndex = process.argv.indexOf('--platform');
const platforms =
  platformArgIndex !== -1 && process.argv[platformArgIndex + 1]
    ? [process.argv[platformArgIndex + 1]]
    : DEFAULT_PLATFORMS;

function loadCacache() {
  const candidates = [];
  if (process.env.npm_execpath) {
    const binDir = path.dirname(process.env.npm_execpath);
    candidates.push(path.join(path.dirname(binDir), 'node_modules', 'cacache'));
  }
  try {
    const globalRoot = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
      encoding: 'utf8',
    }).trim();
    candidates.push(path.join(globalRoot, 'npm', 'node_modules', 'cacache'));
  } catch {
    // fall through to the remaining candidates
  }
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try the next location
    }
  }
  throw new Error('could not load the cacache module bundled with npm');
}

/**
 * Mirrors npm's optional-dependency filtering: a package is installed when its
 * os/cpu lists allow the target. Note that lockfile v3 has no `libc` field, so
 * glibc and musl builds of the same architecture are both candidates.
 */
function isRequiredOn(entry, os, cpu) {
  if (entry.os && !entry.os.includes(os)) {
    return false;
  }
  if (entry.cpu && !entry.cpu.includes(cpu)) {
    return false;
  }
  return true;
}

async function main() {
  const cacache = loadCacache();
  let failed = false;

  for (const platform of platforms) {
    const [os, cpu] = platform.split('-');
    const required = Object.entries(lock.packages ?? {}).filter(
      ([key, entry]) =>
        key && entry.resolved?.startsWith('https://') && entry.integrity && isRequiredOn(entry, os, cpu),
    );

    let ok = 0;
    const missing = [];
    const corrupt = [];

    for (const [key, entry] of required) {
      try {
        const cached = await cacache.get(STORE_DIR, `${CACHE_KEY_PREFIX}${entry.resolved}`);
        const algorithm = entry.integrity.split('-')[0];
        const actual = `${algorithm}-${createHash(algorithm).update(cached.data).digest('base64')}`;
        if (actual === entry.integrity) {
          ok += 1;
        } else {
          corrupt.push(key);
        }
      } catch {
        missing.push(key);
      }
    }

    const status = missing.length === 0 && corrupt.length === 0 ? 'OK' : 'INCOMPLETE';
    console.log(`${platform}: ${ok}/${required.length} vendored and valid -> ${status}`);
    for (const key of missing) {
      console.log(`  missing: ${key}`);
    }
    for (const key of corrupt) {
      console.log(`  integrity mismatch: ${key}`);
    }
    if (missing.length > 0 || corrupt.length > 0) {
      failed = true;
    }
  }

  if (failed) {
    console.error('Vendor store is incomplete. Run: npm run vendor:fetch');
    process.exitCode = 1;
  }
}

await main();
