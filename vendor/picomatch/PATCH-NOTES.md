# picomatch 4.0.8 (vendored security patch)

This directory is a local, **development-only** copy of `picomatch@4.0.7`
with the patch for CVE-2026-112366 / GHSA-fc5q-39xc-vjpf applied.

- Upstream advisory: https://github.com/advisories/GHSA-fc5q-39xc-vjpf
- Patch source: https://github.com/micromatch/picomatch/pull/237 (open,
  unmerged at the time of vendoring)
- Files changed versus 4.0.7: `lib/parse.js`
- Local package version is `4.0.8` so `npm audit` can distinguish this patched
  build from the vulnerable `4.0.7` release; it is not an upstream release.

Why it is here: `vite`, `vitest` and `@typescript-eslint` pull in
`picomatch@4.0.7`, which is reported as a high-severity ReDoS (CVE-2026-112366).
No patched version has been published on npm yet. The package is only used by
build/test/ESLint tooling, never by the shipped application.

The patch collapses single-branch repeated extglobs such as `+(*)`, `+(*a)` and
`*(*a)` so they do not nest two unbounded quantifiers. Smoke tests:

```text
+(*)  -> ^(?:(?=.)(?:[^/]*?))$
+(*a) -> ^(?:(?=.)(?:[^/]*?a))$
*(*a) -> ^(?:(?=.)(?:[^/]*?a)?)$
```

When upstream publishes a fixed `picomatch` release, replace this directory
with the registry version and remove the `picomatch` entry from
`devDependencies`/`overrides` in the root `package.json`.

License: MIT, see `LICENSE`.
