import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Locale coverage check.
 *
 * `src/lib/i18n.ts` initializes i18next with `fallbackLng: 'ru'`, so the
 * Russian dictionary is the reference key set. The script fails when another
 * locale drifts away from it, when a pluralized key lacks a category the
 * language can ask for, or when interpolation placeholders differ between
 * dictionaries (a mismatched `{{count}}` renders as the raw key at runtime).
 *
 * i18next plural suffixes are collapsed before comparison: `hours_one` and
 * `hours_few` are the same logical key, and each language legitimately has its
 * own set of suffixes.
 */
const root = resolve(import.meta.dirname, '..');
const localesDir = resolve(root, 'src/locales');
const REFERENCE = 'ru';

/** CLDR categories i18next can request for an integer or decimal count. */
const PLURAL_CATEGORIES = {
  ru: ['one', 'few', 'many', 'other'],
  en: ['one', 'other'],
};

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Flatten a dictionary into `dotted.key -> value` entries. */
function leaves(value, prefix = '', result = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, result);
    }
  } else {
    result.set(prefix, value);
  }
  return result;
}

const baseKey = (key) => key.replace(PLURAL_SUFFIX, '');
const baseKeys = (dict) => new Set([...dict.keys()].map(baseKey));
const placeholdersOf = (value) =>
  typeof value === 'string' ? new Set([...value.matchAll(PLACEHOLDER)].map((match) => match[1])) : new Set();

function pluralBaseKeys(dict) {
  const bases = new Set();
  for (const key of dict.keys()) {
    if (PLURAL_SUFFIX.test(key)) {
      bases.add(baseKey(key));
    }
  }
  return bases;
}

const files = readdirSync(localesDir).filter((name) => name.endsWith('.json'));
const dictionaries = new Map();
for (const file of files.sort()) {
  dictionaries.set(file.slice(0, -'.json'.length), leaves(JSON.parse(readFileSync(resolve(localesDir, file), 'utf8'))));
}

if (!dictionaries.has(REFERENCE)) {
  console.error(`Missing reference dictionary: src/locales/${REFERENCE}.json`);
  process.exit(1);
}

const reference = dictionaries.get(REFERENCE);
const referenceBases = baseKeys(reference);
const referencePlurals = pluralBaseKeys(reference);
const errors = [];
const warnings = [];

for (const [code, dict] of dictionaries) {
  if (code === REFERENCE) {
    continue;
  }
  const bases = baseKeys(dict);

  for (const key of [...referenceBases].filter((base) => !bases.has(base)).sort()) {
    errors.push(`${code}: missing key "${key}"`);
  }
  for (const key of [...bases].filter((base) => !referenceBases.has(base)).sort()) {
    errors.push(`${code}: key "${key}" does not exist in ${REFERENCE}.json`);
  }

  // Keys unknown to the reference are already reported above.
  for (const [key, value] of dict) {
    if (!reference.has(key)) {
      continue;
    }
    const expected = placeholdersOf(reference.get(key));
    const actual = placeholdersOf(value);
    const lost = [...expected].filter((name) => !actual.has(name));
    const added = [...actual].filter((name) => !expected.has(name));
    if (lost.length > 0 || added.length > 0) {
      const render = (names) => (names.length > 0 ? names.join(', ') : 'none');
      errors.push(`${code}: "${key}" placeholders differ (missing: ${render(lost)}, unexpected: ${render(added)})`);
    }
  }
}

for (const [code, dict] of dictionaries) {
  const categories = PLURAL_CATEGORIES[code];
  if (!categories) {
    warnings.push(`${code}: no plural rule declared in scripts/check-locales.mjs, plural coverage skipped`);
    continue;
  }
  for (const base of [...referencePlurals].sort()) {
    const absent = categories.filter((category) => !dict.has(`${base}_${category}`));
    if (absent.length > 0) {
      errors.push(`${code}: pluralized key "${base}" is missing _${absent.join(', _')}`);
    }
  }
}

for (const warning of warnings) {
  console.warn(warning);
}
for (const error of errors) {
  console.error(error);
}

if (errors.length > 0) {
  console.error(`\nLocale coverage failed: ${errors.length} problem(s).`);
  process.exit(1);
}

console.log(`Locale coverage checked: ${dictionaries.size} dictionaries, ${referenceBases.size} keys, no drift.`);
