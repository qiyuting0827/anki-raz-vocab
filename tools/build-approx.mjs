// Build an approximate 29-level word list from ECDICT (MIT).
//
// The original card deck is a paid product and its full content is not
// publicly available. This script creates a clearly-labelled *approximation*:
// English head words are ranked by corpus frequency and packed into the deck's
// real per-level card counts (AA 430 … Z2 220). It is NOT the official RAZ
// level assignment — use tools/import-apkg.mjs with your own purchased deck
// for exact content.
//
//   node tools/fetch-ecdict.mjs      (once, ~66 MB)
//   node tools/build-approx.mjs
//
// Output: data/words.approx.json  (same shape as data/words.seed.json)
// Then:   node tools/build-data.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decorateChn, stripTags, levelLabel } from './lib/normalize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const CSV = join(ROOT, arg('--csv', 'data/sources/ecdict.csv'));
const OUT = arg('--out', 'data/words.approx.json');
if (!existsSync(CSV)) {
  console.error(`Missing ${CSV} — run \`node tools/fetch-ecdict.mjs\` first.`);
  process.exit(1);
}

const deck = read('data/deck.json');
const seed = existsSync(join(ROOT, 'data/words.seed.json')) ? read('data/words.seed.json') : [];
const levelOrder = deck.levelOrder.map((l) => (l === '0AA' ? 'AA' : l));
const levelCounts = Object.fromEntries(Object.entries(deck.levelCounts).map(([k, v]) => [levelLabel(k), v]));
const target = levelOrder.reduce((n, l) => n + (levelCounts[l] || 0), 0);

/* ---------------- CSV reading (fields may contain commas and newlines) ---------------- */

function* csvRecords(text) {
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      yield row;
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    yield row;
  }
}

const STOPWORDS = new Set(
  `a an the and or but if of to in on at by for with from as is are was were be been being am
   do does did have has had will would can could may might must shall should i you he she it we they
   me him her us them my your his its our their this that these those there here what which who whom
   whose when where why how not no yes so than then too very just also up down out off over under
   again more most some any all both each every few many much other another such only own same
   s t dont doesn didnt isn aren wasn weren won wouldn couldn shouldn ll re ve d m o`.split(/\s+/),
);

const hasChinese = (s) => /[\u4e00-\u9fff]/.test(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function chnFromTranslation(translation) {
  const lines = String(translation)
    .replace(/\\n/g, '\n')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[网络\]/.test(l))
    .slice(0, 4);
  if (!lines.length) return '';
  return decorateChn(lines.map(esc).join('<br>'));
}

function ipaFromPhonetic(phonetic) {
  let p = String(phonetic || '').trim();
  if (!p) return '';
  p = p
    .replace(/^[[/]+|[/\]]+$/g, '')
    .replace(/,/g, 'ˌ')
    .replace(/'/g, 'ˈ')
    .replace(/ә/g, 'ə')   // ECDICT uses Cyrillic schwa
    .replace(/\./g, 'ˌ')  // secondary stress marker
    .replace(/:/g, 'ː')
    .trim();
  return p ? `/${p}/` : '';
}

/* ---------------- collect candidates ---------------- */

const text = readFileSync(CSV, 'utf8');
let header = null;
const best = new Map();

for (const row of csvRecords(text)) {
  if (!header) {
    header = row.map((h) => h.trim().toLowerCase());
    if (header[0] !== 'word') {
      console.error('Unexpected ECDICT header:', row.slice(0, 5).join(','));
      process.exit(1);
    }
    continue;
  }
  const get = (name) => row[header.indexOf(name)] || '';
  const word = get('word').trim().toLowerCase();
  if (!/^[a-z]{2,18}$/.test(word) || STOPWORDS.has(word)) continue;
  const translation = get('translation');
  if (!hasChinese(translation)) continue;
  const frq = Number(get('frq')) || 0;
  const bnc = Number(get('bnc')) || 0;
  const rank = frq > 0 ? frq : bnc > 0 ? bnc + 200000 : 9e8;
  const prev = best.get(word);
  if (!prev || rank < prev.rank) {
    best.set(word, { word, phonetic: get('phonetic'), translation, rank });
    if (best.size % 50000 === 0) process.stdout.write(`\r  scanned ${best.size.toLocaleString()} usable entries`);
  }
}
process.stdout.write('\n');

const candidates = [...best.values()].sort((a, b) => a.rank - b.rank || a.word.localeCompare(b.word));
console.log(`usable entries: ${candidates.length.toLocaleString()} (target ${target.toLocaleString()})`);

/* ---------------- pack into levels ---------------- */

const buckets = Object.fromEntries(levelOrder.map((l) => [l, []]));
const used = new Set();

const push = (level, word) => {
  buckets[level].push(word);
  used.add(word.word.toLowerCase());
};

// The 20 public preview cards are genuine deck content: keep them, as AA.
for (const w of seed) {
  const level = levelLabel(w.grade);
  if (!buckets[level] || buckets[level].length >= (levelCounts[level] || 0)) continue;
  push(level, {
    id: w.id,
    guid: w.guid || `seed-${w.word}`,
    deckId: w.deckId || deck.decks?.[0]?.deckId || null,
    grade: level,
    note: w.note || '',
    word: w.word,
    chn: w.chn,
    ipa: stripTags(w.ipa),
    photoHtml: '',
    images: [],
    sentHtml: w.sentHtml || '',
    wordAudio: '',
    sentAudio: '',
    extraAudio: [],
    photo2: '',
    dictionary: '',
  });
}

let levelIndex = 0;
for (const c of candidates) {
  while (levelIndex < levelOrder.length && buckets[levelOrder[levelIndex]].length >= (levelCounts[levelOrder[levelIndex]] || 0)) {
    levelIndex += 1;
  }
  if (levelIndex >= levelOrder.length) break;
  if (used.has(c.word)) continue;
  const level = levelOrder[levelIndex];
  const chn = chnFromTranslation(c.translation);
  if (!chn) continue;
  push(level, {
    id: `ap-${level}-${c.word}`,
    guid: `approx-${c.word}`,
    deckId: deck.decks?.[0]?.deckId || null,
    grade: level,
    note: '',
    word: c.word,
    chn,
    ipa: ipaFromPhonetic(c.phonetic),
    photoHtml: '',
    images: [],
    sentHtml: '',
    wordAudio: '',
    sentAudio: '',
    extraAudio: [],
    photo2: '',
    dictionary: '',
  });
}

const words = levelOrder.flatMap((l) => buckets[l]);
writeFileSync(join(ROOT, OUT), JSON.stringify(words, null, 0), 'utf8');

const short = levelOrder.filter((l) => buckets[l].length < (levelCounts[l] || 0));
console.log(`wrote ${OUT}: ${words.length.toLocaleString()} words`);
console.log(levelOrder.map((l) => `${l}:${buckets[l].length}/${levelCounts[l] || 0}`).join('  '));
if (short.length) console.log(`short levels: ${short.join(', ')}`);
