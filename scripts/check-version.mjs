import { readFileSync } from 'node:fs';

/**
 * Version consistency check.
 *
 * `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` must
 * carry the same version: the release workflow validates the git tag against
 * `package.json`, while the installer and the About screen read the Tauri and
 * Cargo values. A silent drift produces installers named after one version and
 * an About dialog reporting another.
 */
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const packageVersion = JSON.parse(read('../package.json')).version;
const tauriVersion = JSON.parse(read('../src-tauri/tauri.conf.json')).version;
const cargoVersion = read('../src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1];

if (!cargoVersion || tauriVersion !== packageVersion || cargoVersion !== packageVersion) {
  console.error('Version mismatch:', { packageVersion, tauriVersion, cargoVersion });
  process.exit(1);
}

console.log(`version ${packageVersion} is consistent`);
