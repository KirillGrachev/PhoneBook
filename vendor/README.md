# Vendored dependencies

This directory makes `npm install` work without a reliable connection to
`registry.npmjs.org`.

```
vendor/
├── npm-cache/     # npm cache holding every tarball of package-lock.json
├── manifest.json  # audit list: package, version, resolved URL, integrity
└── picomatch/     # patched picomatch (file: dependency, see its PATCH-NOTES.md)
```

## How to use it

Just run the normal command in the project root:

```bat
npm install
```

Nothing else is required — no flags, no manual `npm cache add`, no environment
variables. `npm ci` works the same way.

## How it works

`.npmrc` in the project root points npm at the vendored store:

```ini
cache=vendor/npm-cache
prefer-offline=true
```

* Every registry tarball of `package-lock.json` is already inside
  `vendor/npm-cache/_cacache`, stored under the exact key npm looks up
  (`make-fetch-happen:request-cache:<registry url>`).
* Because the cache is part of the project, it is available on a **cold** start.
  This matters: npm begins fetching tarballs concurrently with lifecycle scripts,
  so a `preinstall` hook that populates the cache loses that race.
* `prefer-offline` is used instead of a hard `offline`. Anything that is not
  vendored is still fetched from the network, so the setup degrades gracefully
  rather than failing.
* The lockfile, the dependency tree and all upstream `integrity` hashes are
  untouched. npm still verifies every archive against its SHA-512 hash.

The fallback network settings in `.npmrc` are deliberately conservative, because
corporate proxies and antivirus filters often reset parallel TLS connections
(`ECONNRESET`):

```ini
maxsockets=1
fetch-retries=5
fetch-retry-mintimeout=20000
fetch-retry-maxtimeout=120000
fetch-timeout=600000
```

## Which platforms are covered

Platform selection follows what the project actually builds and tests on:
`.github/workflows/release.yml` and `ci.yml` use `windows-latest` and
`ubuntu-24.04`, and the release artifacts are Windows x64.

Vendored by default:

| Target | Coverage |
| --- | --- |
| `win32-x64` (release + workstation) | 358 / 358 |
| `linux-x64` (CI, glibc **and** musl) | 362 / 362 |

Both glibc and musl builds of x64 are included deliberately. `package-lock.json`
v3 records `os` and `cpu` but **no `libc` field**, so npm cannot distinguish the
two and requests the musl variant even on a glibc host. Leaving musl out caused
exactly four network fetches on Ubuntu — a hole in the project's own CI coverage.

Not vendored: macOS, Windows ARM64, Linux ARM/ppc64/riscv64, FreeBSD, Android.
The project never builds or runs on those, and their native binaries add
**~222 MB** (the store would grow from ~107 MB to ~308 MB). If such a target is
ever added, either run `npm run vendor:fetch -- --all-platforms` or let the
`prefer-offline` fallback fetch just those few archives.

Coverage is asserted, not assumed:

```bat
npm run vendor:verify
```

```text
win32-x64: 358/358 vendored and valid -> OK
linux-x64: 362/362 vendored and valid -> OK
```

The script mirrors npm's os/cpu filtering and checks every archive against its
lockfile integrity hash, exiting non-zero on any gap. To check another target:

```bat
node scripts/vendor-verify.mjs --platform darwin-arm64
```

With the store complete, a cold `npm install` performs **zero** network requests.

## Refreshing the store

After changing dependencies (and committing the updated `package-lock.json`):

```bat
npm run vendor:fetch
```

Options:

```bat
node scripts/vendor-fetch.mjs --all-platforms   # every optional native binary
node scripts/vendor-fetch.mjs --force           # re-download even if present
```

The script downloads each tarball, verifies its integrity against the lockfile
and only then writes it into the store, so a truncated download can never poison
the cache. `vendor/manifest.json` is regenerated as the audit list.

## Notes

* `vendor/npm-cache/_logs` and `vendor/npm-cache/tmp` are transient npm artifacts
  and are gitignored; the `_cacache` store itself is meant to be committed or
  copied along with the project.
* The store is excluded from the Vite file watcher and from Tailwind's source
  scanner (`@source not` in `src/index.css`) — it is a binary package store, not
  application source.
* If the project directory is read-only, npm cannot write its logs there. Either
  make it writable or override the cache location for that run:
  `npm install --cache "%LOCALAPPDATA%\npm-cache"`.
