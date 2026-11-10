# Code signing and updates

The release workflow builds MSI/NSIS installers, but the repository does not
contain a code-signing certificate. Unsigned installers trigger SmartScreen
warnings, so a production release must be signed by the publisher.

## Authenticode

Tauri reads the Authenticode certificate from the standard Windows certificate
store. Do not commit the private key or its password.

For Authenticode (MSI/NSIS), use a code-signing certificate installed in
`Cert:\CurrentUser\My` and configure `bundle.windows.certificateThumbprint` in
`src-tauri/tauri.conf.json` locally, or pass it through the release workflow.
Never commit the private key or its password.

Recommended: an EV code-signing certificate in an HSM/token, with the build
running on a controlled release runner. The certificate must be valid for
`KMAruda Phonebook` and the installer publisher name.

## Updates

There is no auto-update channel yet: releases are installed manually from the
GitHub Releases page. If auto-update is enabled later, it must use the Tauri
updater with:

- a separate minisign key pair, with the public key committed in
  `tauri.conf.json`;
- a signed `latest.json` manifest published with each release;
- an HTTPS endpoint controlled by the publisher.

Do not reuse the Authenticode certificate as the updater signing key.
