import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function versionOf(spec) {
  const match = String(spec).match(/\d+\.\d+\.\d+/);
  if (!match) throw new Error(`cannot parse version from ${spec}`);
  return match[0];
}

function majorMinor(version) {
  return version.split('.').slice(0, 2).join('.');
}

const cargo = read('src-tauri/Cargo.toml');
const cargoMatch = cargo.match(/^tauri\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/m);
if (!cargoMatch) throw new Error('tauri crate version not found in src-tauri/Cargo.toml');

const packageJson = JSON.parse(read('package.json'));
const apiSpec = packageJson.dependencies?.['@tauri-apps/api'];
const cliSpec = packageJson.devDependencies?.['@tauri-apps/cli'];
if (!apiSpec || !cliSpec) throw new Error('@tauri-apps/api or @tauri-apps/cli missing from package.json');

const crate = versionOf(cargoMatch[1]);
const api = versionOf(apiSpec);
const cli = versionOf(cliSpec);
const expected = majorMinor(crate);

for (const [name, version] of [
  ['@tauri-apps/api', api],
  ['@tauri-apps/cli', cli],
]) {
  if (majorMinor(version) !== expected) {
    throw new Error(
      `Tauri version mismatch: crate ${crate}, ${name} ${version}; expected same major/minor ${expected}.x`,
    );
  }
}

console.log(`Tauri versions aligned: crate ${crate}, API ${api}, CLI ${cli}`);
