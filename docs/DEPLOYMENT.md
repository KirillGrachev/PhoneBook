# Embedded configuration deployment

The `embedded-config` build compiles an exported `kmaruda-config.json` into the
executable. It is intended for managed rollout: AD connections, organization
groups, the KMAruda group, synchronization timings, external phone books and
the managed test/global switches come from the profile.

## What stays local

- theme and language;
- animations toggle;
- **Show avatars** toggle;
- saved contacts;
- email overrides;
- window size/position;
- LDAP bind passwords (Credential Manager only; never in the profile or exe).

All administrative settings are protected in Rust on `load` and `save`, not
only by hiding their controls. A direct IPC call cannot override them.

## 1. Build a reference profile

1. Install a regular build on a reference machine.
2. Configure AD connections, organization groups and external phone books.
3. Open **Settings → Transfer → Export configuration**.
4. Save the resulting `kmaruda-config.json` under `profiles/` (git-ignored).
5. Optionally add top-level fields for diagnostics:

   ```json
   {
     "profile": "KMAruda",
     "revision": 4,
     "format": "kmaruda-phonebook/config",
     "version": 1,
     "config": { ... }
   }
   ```

   The file must not contain passwords. `hasPassword` is always reset during
   import; configured bind passwords must be entered on each machine (or
   delivered separately through Credential Manager automation).

## 2. Build the managed variant

PowerShell:

```powershell
$env:KMPB_EMBED_CONFIG = "$PWD/profiles/kmaruda.json"
npm run tauri build -- --features embedded-config
```

The profile is validated at build time (JSON and format marker) and included
with `include_str!`; it is covered by the executable signature if one is added
later. Without the feature and environment variable the normal build is
unchanged.

## 3. CI / release

Store the profile as a base64 GitHub Actions secret named
`KMPB_EMBED_CONFIG_B64` (base64 of the JSON file, no line breaks). The manual
**Embedded configuration build** workflow decodes it, builds `--features
embedded-config`, and uploads MSI/EXE assets with `-embedded` in the name.
The normal release workflow remains the standard, unmanaged build.

To create the secret value on Windows:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("profiles/kmaruda.json"))
```

Do not commit a production profile to the public repository.

## 4. Verification

- The Settings screen shows the managed banner with the profile name.
- AD, Groups, Synchronization, External phone books and configuration transfer
  are **hidden**, not merely disabled; direct links to them return to the
  settings root. Direct IPC edits are still overwritten from the profile.
- Theme, language, avatars, favorites and animations remain editable and
  survive a profile update.
- `About` shows the normal version block only; profile metadata is shown in the
  Settings banner.
- On first launch with no cache, the profile has LDAP configured, so the normal
  sync starts and fills the directory without user action.

See `src-tauri/tests/fixtures/embedded-config.json` for the test profile and
`src-tauri/src/services/config/embedded.rs` for the overlay implementation.
