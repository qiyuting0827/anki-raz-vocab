// Download ECDICT (MIT licensed, https://github.com/skywind3000/ECDICT)
// into data/sources/ecdict.csv. Used by tools/build-approx.mjs to build an
// approximate, frequency-ranked 29-level word list when the exact paid deck
// is not available.
//
//   node tools/fetch-ecdict.mjs
//
// The file is ~66 MB. It is cached: delete it to force a fresh download.

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/sources/ecdict.csv');

const URLS = [
  'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
  // Mirrors for networks where GitHub raw is blocked.
  'https://ghproxy.net/https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
  'https://cdn.jsdelivr.net/gh/skywind3000/ECDICT@master/ecdict.csv',
];

if (existsSync(OUT) && statSync(OUT).size > 1_000_000) {
  console.log(`cached: ${OUT} (${(statSync(OUT).size / 1048576).toFixed(1)} MB)`);
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });

let lastError;
for (const url of URLS) {
  try {
    console.log(`fetching ${url}`);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const tmp = OUT + '.tmp';
    await new Promise((resolve, reject) => {
      const file = createWriteStream(tmp);
      Readable.fromWeb(res.body).pipe(file).on('finish', resolve).on('error', reject);
    });
    const size = statSync(tmp).size;
    if (size < 1_000_000) throw new Error(`suspicious size ${size}`);
    renameSync(tmp, OUT);
    console.log(`saved ${OUT} (${(size / 1048576).toFixed(1)} MB)`);
    process.exit(0);
  } catch (err) {
    lastError = err;
    console.warn(`  failed: ${err.message}`);
  }
}

console.error('Could not download ECDICT.');
console.error('Download ecdict.csv manually from https://github.com/skywind3000/ECDICT');
console.error('and save it as data/sources/ecdict.csv, then re-run this script.');
console.error(String(lastError && lastError.message));
process.exit(1);
