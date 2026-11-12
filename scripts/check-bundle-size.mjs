import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/assets';
const maxChunk = 300 * 1024;
const maxTotal = 1100 * 1024;

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, size: statSync(join(dir, name)).size }));

const total = files.reduce((sum, file) => sum + file.size, 0);
const largest = files.sort((a, b) => b.size - a.size).slice(0, 5);
console.log(
  `bundle: ${files.length} JS chunks, ${(total / 1024).toFixed(1)} KiB total; largest: ${largest
    .map((file) => `${file.name}=${(file.size / 1024).toFixed(1)} KiB`)
    .join(', ')}`,
);

if (total > maxTotal) {
  console.error(`bundle budget exceeded: ${total} > ${maxTotal} bytes`);
  process.exit(1);
}
for (const file of files) {
  if (file.size > maxChunk) {
    console.error(`chunk too large: ${file.name} = ${file.size} > ${maxChunk} bytes`);
    process.exit(1);
  }
}
