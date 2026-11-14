import { readFileSync } from 'node:fs';

const TS_CONTRACTS = 'src/api/contracts.ts';

const PAIRS = [
  { ts: 'EmployeeDto', rust: 'Employee', file: 'src-tauri/src/services/db/model.rs' },
  { ts: 'LdapOrgConfigDto', rust: 'LdapOrgConfig', file: 'src-tauri/src/services/config/model.rs' },
  { ts: 'LdapOrgInput', rust: 'LdapOrgInput', file: 'src-tauri/src/services/config/model.rs' },
  { ts: 'OrgGroupDto', rust: 'OrgGroup', file: 'src-tauri/src/services/config/model.rs' },
  { ts: 'SearchPageDto', rust: 'SearchPage', file: 'src-tauri/src/services/db/model.rs' },
  { ts: 'SearchParamsDto', rust: 'SearchParams', file: 'src-tauri/src/services/db/model.rs' },
  { ts: 'OrgSyncStateDto', rust: 'OrgSyncState', file: 'src-tauri/src/services/sync.rs' },
  { ts: 'SyncStatusDto', rust: 'SyncStatus', file: 'src-tauri/src/services/sync.rs' },
  { ts: 'VCardInputDto', rust: 'VCardInput', file: 'src-tauri/src/services/vcard.rs' },
];

function block(source, pattern) {
  const match = source.match(pattern);
  if (!match) throw new Error(`block not found: ${pattern}`);
  return match[1];
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function tsFields(name) {
  const source = readFileSync(TS_CONTRACTS, 'utf8');
  const body = block(source, new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`, 'm'));
  return new Set([...stripComments(body).matchAll(/^\s*([A-Za-z_$][\w$]*)\??\s*:/gm)].map((match) => match[1]));
}

function camelCase(value) {
  return value.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function rustFields(name, file) {
  const source = readFileSync(file, 'utf8');
  const body = block(source, new RegExp(`pub struct ${name} \\{([\\s\\S]*?)\\n\\}`, 'm'));
  const fields = new Set();
  let rename = null;
  let skipped = false;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('#[serde(skip)]')) {
      skipped = true;
      continue;
    }
    const renamed = line.match(/#\[serde\(rename\s*=\s*"([^"]+)"\)\]/);
    if (renamed) {
      rename = renamed[1];
      continue;
    }
    const field = line.match(/^pub\s+([a-z0-9_]+)\s*:/);
    if (!field) continue;
    if (!skipped) fields.add(rename ?? camelCase(field[1]));
    rename = null;
    skipped = false;
  }
  return fields;
}

let failed = 0;
for (const pair of PAIRS) {
  const ts = tsFields(pair.ts);
  const rust = rustFields(pair.rust, pair.file);
  const missingInTs = [...rust].filter((field) => !ts.has(field));
  const extraInTs = [...ts].filter((field) => !rust.has(field));
  if (missingInTs.length > 0 || extraInTs.length > 0) {
    failed += 1;
    console.error(`contract mismatch ${pair.ts} <-> ${pair.rust}`);
    if (missingInTs.length > 0) console.error(`  missing in TS: ${missingInTs.join(', ')}`);
    if (extraInTs.length > 0) console.error(`  only in TS: ${extraInTs.join(', ')}`);
  } else {
    console.log(`ok ${pair.ts} (${rust.size} fields)`);
  }
}

if (failed > 0) {
  process.exit(1);
}
