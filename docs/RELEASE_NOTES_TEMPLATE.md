# Release notes template

Replace every `X.Y.Z`, file name, commit hash and comparison range. Keep the
same section order as the GitHub releases.

```markdown
## Install

Normal users: use `KMAruda.PhoneBook_X.Y.Z_x64-setup.exe`. The
`KMAruda.PhoneBook_X.Y.Z_x64_ru-RU.msi` is the MSI payload for enterprise
deployment. The `KMAruda.PhoneBook_X.Y.Z_windows-x64_portable.zip` runs without
installation. The WebView2 bootstrapper is embedded in the installer.

## What changed

### Features

- **Feature name:** what changed and why it matters
  ([abc1234](https://github.com/KirillGrachev/PhoneBook/commit/<full-sha>))

### Fixes

- **Fixed behaviour:** what was broken and what is different now
  ([abc1234](https://github.com/KirillGrachev/PhoneBook/commit/<full-sha>))

### Internal

- Tests, installer or CI change
  ([abc1234](https://github.com/KirillGrachev/PhoneBook/commit/<full-sha>))

**Full Changelog**: https://github.com/KirillGrachev/PhoneBook/compare/vPREVIOUS...vX.Y.Z

**Note:** the binaries are not Authenticode-signed yet; Windows SmartScreen may
show a warning.
```

Every `###` change bullet needs its own commit link. The `Release X.Y.Z` line
does not need a link.

