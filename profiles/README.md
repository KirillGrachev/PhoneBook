# Embedded configuration profiles

This directory is for a local `kmaruda-config.json` export used by the
`embedded-config` build. Real deployment profiles contain internal DC names and
paths and must not be committed to this public repository.

Create a profile from the reference machine:

1. Configure AD, organization groups and external phone books in the app.
2. Open **Settings → Transfer → Export configuration**.
3. Save `kmaruda-config.json` here (the file is git-ignored).
4. Optionally edit top-level `"profile"` and `"revision"` fields for diagnostics.

Build:

```powershell
$env:KMPB_EMBED_CONFIG = "$PWD/profiles/kmaruda.json"
npm run tauri build -- --features embedded-config
```

See [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) for the full deployment and CI
setup.
