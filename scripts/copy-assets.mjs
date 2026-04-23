/**
 * Copy JSON assets (abbreviation dictionaries) from src/ to dist/
 * because tsc does not copy non-.ts files.
 *
 * Uses explicit readFile/writeFile to be idempotent across re-builds
 * (avoids EPERM from cp's unlink-before-overwrite on some filesystems).
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const pairs = [['src/abbreviations', 'dist/abbreviations']];

for (const [from, to] of pairs) {
  const src = join(ROOT, from);
  const dest = join(ROOT, to);
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const buf = await readFile(join(src, entry.name));
    await writeFile(join(dest, entry.name), buf);
    copied++;
  }
  console.error(`[copy-assets] ${from} -> ${to} (${copied} files)`);
}
