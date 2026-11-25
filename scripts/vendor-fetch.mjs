/**
 * Rebuilds `vendor/npm-cache` - a self-contained npm cache holding every registry
 * tarball referenced by package-lock.json.
 *
 * `.npmrc` points npm at this directory (`cache=vendor/npm-cache`), so a plain
 * `npm install` finds all packages on disk. `prefer-offline` is used instead of a
 * hard `offline`, so anything not vendored is still fetched from the network with
 * conservative, proxy-friendly settings.
 *
 * Why a cache and not a `preinstall` hook that runs `npm cache add`:
 *   1. `npm cache add <file>` stores a `pacote:tarball:file:...` key, while npm
 *      resolves locked dependencies via `make-fetch-happen:request-cache:<url>`.
 *   2. npm starts fetching tarballs concurrently with the `preinstall` script, so
 *      seeding from that hook loses the race on a cold cache.
 * Shipping the populated cache avoids both problems and keeps the lockfile, the
 * dependency tree and every upstream integrity hash untouched.
 *
 * Usage:
 *   node scripts/vendor-fetch.mjs                  # win32-x64 + current platform
 *   node scripts/vendor-fetch.mjs --all-platforms  # every optional native binary
 *   node scripts/vendor-fetch.mjs --force          # re-download even if cached
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'vendor', 'npm-cache');
const STORE_DIR = path.join(CACHE_DIR, '_cacache');
const MANIFEST = path.join(ROOT, 'vendor', 'manifest.json');
const CACHE_KEY_PREFIX = 'make-fetch-happen:request-cache:';
const CONCURRENCY = 8;
const ATTEMPTS = 5;

const args = new Set(process.argv.slice(2));
const allPlatforms = args.has('--all-platforms');
const force = args.has('--force');
const require = createRequire(import.meta.url);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Platforms whose optional native binaries are vendored by default: the ones the
 * project actually builds and tests on (release.yml / ci.yml use windows-latest
 * and ubuntu-24.04). Other systems are left to the network fallback - vendoring
 * every architecture would add ~220 MB of binaries the project never executes.
 */
const TARGET_PLATFORMS = [
  { os: 'win32', cpu: 'x64' }, // release target and developer workstation
  { os: 'linux', cpu: 'x64' }, // CI: ubuntu-24.04 (glibc and musl variants)
  { os: process.platform, cpu: process.arch }, // whatever runs the fetch
];

/**
 * Platform selection is driven by os/cpu only.
 *
 * Both glibc and musl builds of a target architecture are vendored on purpose:
 * package-lock.json v3 records `os` and `cpu` but no `libc`, so npm cannot tell
 * the two apart and requests the musl variant even on a glibc host. Skipping it
 * would leave a hole for the project's own Ubuntu CI.
 */
function isWanted(entry) {
  if (allPlatforms) {
    return true;
  }
  if (!entry.os && !entry.cpu) {
    return true;
  }
  const osList = entry.os ?? [process.platform];
  const cpuList = entry.cpu ?? [process.arch];
  return TARGET_PLATFORMS.some((target) => osList.includes(target.os) && cpuList.includes(target.cpu));
}

/** Loads the `cacache` build shipped inside the running npm. */
function loadCacache() {
  const candidates = [];
  if (process.env.npm_execpath) {
    const binDir = path.dirname(process.env.npm_execpath);
    candidates.push(path.join(path.dirname(binDir), 'node_modules', 'cacache'));
  }
  try {
    const globalRoot = execFileSync(npmCommand, ['root', '-g'], { encoding: 'utf8' }).trim();
    candidates.push(path.join(globalRoot, 'npm', 'node_modules', 'cacache'));
  } catch {
    // Global root may be unavailable; other candidates can still work.
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

function integrityOf(buffer, expected) {
  const algorithm = expected.split('-')[0] ?? 'sha512';
  return `${algorithm}-${createHash(algorithm).update(buffer).digest('base64')}`;
}

/** Response metadata for an immutable registry tarball, as npm stores it. */
function tarballMetadata(url) {
  const now = Date.now();
  return {
    time: now,
    url,
    reqHeaders: {},
    resHeaders: {
      'cache-control': 'public, immutable, max-age=31557600',
      'content-type': 'application/octet-stream',
      date: new Date(now).toUTCString(),
    },
    options: { compress: true },
  };
}

async function download(url, expectedIntegrity) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const actual = integrityOf(buffer, expectedIntegrity);
      if (actual !== expectedIntegrity) {
        throw new Error(`integrity mismatch: expected ${expectedIntegrity}, got ${actual}`);
      }
      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

async function main() {
  const cacache = loadCacache();
  const lock = JSON.parse(await readFile(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const wanted = Object.entries(lock.packages ?? {})
    .filter(([key, entry]) => key && entry.resolved?.startsWith('https://') && entry.integrity && isWanted(entry))
    .map(([key, entry]) => ({
      name: key.replace(/^.*node_modules\//, ''),
      version: entry.version,
      resolved: entry.resolved,
      integrity: entry.integrity,
      ...(entry.os ? { os: entry.os } : {}),
      ...(entry.cpu ? { cpu: entry.cpu } : {}),
    }));

  await mkdir(STORE_DIR, { recursive: true });
  const staging = await mkdtemp(path.join(os.tmpdir(), 'phonebook-vendor-'));

  const entries = [];
  const failures = [];
  let downloaded = 0;
  let reused = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < wanted.length) {
      const item = wanted[cursor++];
      const key = `${CACHE_KEY_PREFIX}${item.resolved}`;
      try {
        let buffer = null;
        if (!force) {
          // Reuse what the vendor cache already holds, verified by integrity.
          try {
            const existing = await cacache.get(STORE_DIR, key);
            if (integrityOf(existing.data, item.integrity) === item.integrity) {
              reused += 1;
              entries.push(item);
              continue;
            }
          } catch {
            // Not cached yet: download below.
          }
        }
        buffer = await download(item.resolved, item.integrity);
        await cacache.put(STORE_DIR, key, buffer, { metadata: tarballMetadata(item.resolved) });
        downloaded += 1;
        entries.push(item);
        if (downloaded % 25 === 0) {
          console.log(`  fetched ${downloaded} ...`);
        }
      } catch (error) {
        failures.push({ ...item, error: String(error?.message ?? error) });
      }
    }
  }

  console.log(`Vendoring ${wanted.length} tarballs into vendor/npm-cache ...`);
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  entries.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  await writeFile(
    MANIFEST,
    `${JSON.stringify(
      {
        note: 'Audit list of the tarballs held in vendor/npm-cache. Regenerate with: npm run vendor:fetch',
        lockfileVersion: lock.lockfileVersion,
        platforms: allPlatforms ? 'all' : TARGET_PLATFORMS,
        packages: entries,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`done: ${downloaded} fetched, ${reused} already vendored, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`  FAILED ${failure.name}@${failure.version}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

await main();
