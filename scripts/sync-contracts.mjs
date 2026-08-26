import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = [
  {
    source: resolve(root, 'schemas/layout.schema.json'),
    destinations: [
      resolve(root, 'internal/layout/schema.json'),
      resolve(root, 'web/src/shared/layout.schema.json'),
    ],
  },
  {
    // Host preset is canonical; the frontend copy must stay byte-identical.
    source: resolve(root, 'internal/layout/presets/xbox-default.json'),
    destinations: [resolve(root, 'web/src/layouts/xbox-default.json')],
  },
];
const checkOnly = process.argv.includes('--check');

for (const { source, destinations } of contracts) {
  const canonical = await readFile(source);
  for (const destination of destinations) {
    if (checkOnly) {
      const generated = await readFile(destination).catch(() => null);
      if (!generated || !generated.equals(canonical)) {
        throw new Error(`contract drift: ${destination}`);
      }
      continue;
    }
    await writeFile(destination, canonical);
  }
}
