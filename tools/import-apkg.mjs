// Import your own legally purchased Anki .apkg export into this project's
// zero-build data format.
//
//   node tools/import-apkg.mjs <path/to/deck.apkg> [--deck "<name substring>"] [--out data]
//
// - Reads the ZIP container with node:zlib (no npm dependencies).
// - Reads collection.anki2 / collection.anki21 with node:sqlite.
// - collection.anki21b (zstd) is not supported: re-export with
//   "支持旧版 Anki / Support older Anki versions".
// - Writes data/words.full.json, data/deck.imported.json and data/media/*.
//   Nothing outside the project's data/ directory is ever written.

import {
  closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync,
  readSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { normalizeNote, LEVEL_ORDER, levelLabel } from './lib/normalize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_ROOT = resolve(ROOT, 'data');
const DISPLAY_ORDER = LEVEL_ORDER.map(levelLabel); // 0AA -> AA

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_EOCD = 0x06054b50;

const USAGE = `用法: node tools/import-apkg.mjs <path/to/deck.apkg> [--deck "<名称片段>"] [--out data]

  <path/to/deck.apkg>  你自己合法导出的 Anki 牌组文件
  --deck              只导入名称包含该片段的顶层牌组（默认优先「背诵」牌组）
  --out               输出目录，只能是项目内的 data/（默认 data）`;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  let file = null;
  let deck = null;
  let out = 'data';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--deck' || arg === '--out') {
      const value = argv[++i];
      if (value == null || value === '') fail(`${arg} 需要一个参数。\n\n${USAGE}`);
      if (arg === '--deck') deck = value;
      else out = value;
    } else if (arg.startsWith('--deck=')) {
      deck = arg.slice('--deck='.length);
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
    } else if (arg.startsWith('-')) {
      fail(`未知参数：${arg}\n\n${USAGE}`);
    } else if (!file) {
      file = arg;
    } else {
      fail(`多余的参数：${arg}\n\n${USAGE}`);
    }
  }

  if (!file) fail(`缺少 .apkg 文件路径。\n\n${USAGE}`);
  if (deck === '') deck = null;
  return { file, deck, out };
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader: EOCD + central directory, stored(0) + deflate(8).

function readExactly(fd, buffer, offset, length, position) {
  let done = 0;
  while (done < length) {
    const read = readSync(fd, buffer, offset + done, length - done, position + done);
    if (read <= 0) fail('读取 ZIP 文件时意外到达文件结尾，文件可能已损坏。');
    done += read;
  }
}

function readZip(file) {
  const fd = openSync(file, 'r');

  const close = () => {
    try { closeSync(fd); } catch { /* already closed */ }
  };

  try {
    const size = fstatSync(fd).size;
    if (size < 22) fail('文件太小，不是有效的 ZIP/.apkg 文件。');

    const tailLength = Math.min(size, 65557); // max EOCD + max comment
    const tail = Buffer.alloc(tailLength);
    readExactly(fd, tail, 0, tailLength, size - tailLength);

    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) !== ZIP_EOCD) continue;
      const commentLength = tail.readUInt16LE(i + 20);
      if (i + 22 + commentLength <= tailLength) { eocd = i; break; }
    }
    if (eocd < 0) fail('不是有效的 ZIP/.apkg 文件：找不到 ZIP 结束记录 (EOCD)。');

    const disk = tail.readUInt16LE(eocd + 4);
    const cdDisk = tail.readUInt16LE(eocd + 6);
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);

    if (disk !== 0 || cdDisk !== 0) fail('不支持分卷 ZIP 文件。');
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      fail('不支持 ZIP64 格式的 .apkg（条目过多或文件过大）。');
    }
    if (cdOffset + cdSize > size) fail('ZIP 中央目录位置超出文件范围，文件可能已损坏。');

    const cd = Buffer.alloc(cdSize);
    readExactly(fd, cd, 0, cdSize, cdOffset);

    const entries = new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== ZIP_CENTRAL) {
        fail('ZIP 中央目录损坏。');
      }
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const uncompSize = cd.readUInt32LE(p + 24);
      const nameLength = cd.readUInt16LE(p + 28);
      const extraLength = cd.readUInt16LE(p + 30);
      const commentLength = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLength);

      if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
        fail(`不支持 ZIP64 条目：${name}`);
      }
      if (!entries.has(name)) {
        entries.set(name, { name, method, compSize, uncompSize, localOffset });
      }
      p += 46 + nameLength + extraLength + commentLength;
    }

    const read = (entryOrName) => {
      const entry = typeof entryOrName === 'string' ? entries.get(entryOrName) : entryOrName;
      if (!entry) fail(`ZIP 中缺少条目：${entryOrName}`);
      if (entry.name.endsWith('/')) return Buffer.alloc(0);

      const local = Buffer.alloc(30);
      readExactly(fd, local, 0, 30, entry.localOffset);
      if (local.readUInt32LE(0) !== ZIP_LOCAL) fail(`ZIP 本地文件头损坏：${entry.name}`);

      const nameLength = local.readUInt16LE(26);
      const extraLength = local.readUInt16LE(28);
      const dataStart = entry.localOffset + 30 + nameLength + extraLength;

      const compressed = Buffer.alloc(entry.compSize);
      if (entry.compSize > 0) readExactly(fd, compressed, 0, entry.compSize, dataStart);

      if (entry.method === 0) return compressed;
      if (entry.method === 8) return inflateRawSync(compressed);
      fail(`不支持的 ZIP 压缩方式 ${entry.method}（仅支持 stored/deflate）：${entry.name}`);
    };

    return { entries, read, close };
  } catch (err) {
    close();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Collection reading.

const FIELD_SPECS = [
  { key: 'grade', names: ['grade'], index: 0 },
  { key: 'note', names: ['个人笔记', 'note', 'notes'], index: 1 },
  { key: 'word', names: ['word'], index: 2 },
  { key: 'chn', names: ['chn'], index: 3 },
  { key: 'ipa', names: ['ipa', 'symbol'], index: 4 },
  { key: 'photo', names: ['photo'], index: 5 },
  { key: 'photosen', names: ['photosen'], index: 6 },
  { key: 'ssound', names: ['ssound'], index: 7 },
  { key: 'audio', names: ['audio'], index: 8 },
  { key: 'photo2', names: ['photo2'], index: 9 },
  { key: 'dictionary', names: ['dictionary'], index: 10 },
];

const normalizeFieldName = (name) => String(name ?? '').trim().toLowerCase();

function modelFields(model) {
  if (Array.isArray(model?.flds)) return model.flds;
  if (model?.flds && typeof model.flds === 'object') return Object.values(model.flds);
  return [];
}

function findModel(modelsJson) {
  const models = Object.values(modelsJson || {}).filter((m) => m && typeof m === 'object');
  const namesOf = (model) => modelFields(model).map((f) => normalizeFieldName(f?.name));
  const candidates = models.filter((model) => namesOf(model).includes('word'));

  if (candidates.length === 0) {
    const available = models
      .map((model) => `${model.name || '(未命名)'} [${namesOf(model).join(', ')}]`)
      .join('; ');
    fail(`牌组中找不到包含 word 字段的模板。可用模板：${available || '(无)'}`);
  }

  return candidates.find((model) => /tank562-raz/i.test(String(model.name || ''))) || candidates[0];
}

function buildFieldIndices(model) {
  const fields = modelFields(model);
  const byName = new Map();
  fields.forEach((field, index) => {
    const name = normalizeFieldName(field?.name);
    if (name && !byName.has(name)) byName.set(name, index);
  });

  return FIELD_SPECS.map((spec) => {
    for (const name of spec.names) {
      if (byName.has(name)) return byName.get(name);
    }
    return spec.index < fields.length ? spec.index : -1;
  });
}

function parseJson(value, label) {
  if (value == null) fail(`collection 缺少 ${label}。`);
  try {
    return JSON.parse(String(value));
  } catch {
    fail(`collection 的 ${label} 不是有效 JSON。`);
  }
}

function readCollection(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tableNames = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name)),
    );
    for (const table of ['col', 'notes', 'cards']) {
      if (!tableNames.has(table)) {
        fail(`collection 数据库缺少 ${table} 表，可能不是 Anki 牌组（或格式过新）。`);
      }
    }

    const col = db.prepare('SELECT models, decks FROM col LIMIT 1').get();
    if (!col) fail('collection 的 col 表是空的，无法读取模板与牌组信息。');

    const models = parseJson(col.models, 'models');
    const decks = parseJson(col.decks, 'decks');

    const noteStatement = db.prepare('SELECT id, guid, mid, flds, tags FROM notes');
    const noteIterator = typeof noteStatement.iterate === 'function'
      ? noteStatement.iterate()
      : noteStatement.all();
    const notes = [];
    for (const row of noteIterator) notes.push(row);

    const cards = db.prepare('SELECT id, nid, did, due FROM cards').all();

    return { models, decks, notes, cards };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Deck selection: top decks matching --deck (default: 背诵), plus children.

function findSeparator(name) {
  if (name.includes('::')) return '::';
  if (name.includes('\x1f')) return '\x1f';
  return null;
}

function selectDecks(decks, filter) {
  const tops = decks.filter((deck) => findSeparator(deck.name) === null);
  const topDecks = tops.length > 0 ? tops : decks;

  let selectedTops;
  let effectiveFilter = filter;

  if (filter) {
    selectedTops = topDecks.filter((deck) => deck.name.includes(filter));
    if (selectedTops.length === 0) {
      fail(`没有找到名称包含「${filter}」的顶层牌组。可用顶层牌组：${
        topDecks.map((deck) => deck.name).join(' | ')
      }`);
    }
  } else {
    selectedTops = topDecks.filter((deck) => deck.name.includes('背诵'));
    if (selectedTops.length === 0) {
      selectedTops = topDecks;
      effectiveFilter = null;
    } else {
      effectiveFilter = '背诵';
    }
  }

  const selectedIds = new Set();
  for (const top of selectedTops) {
    selectedIds.add(top.id);
    for (const deck of decks) {
      if (deck.id === top.id) continue;
      for (const separator of ['::', '\x1f']) {
        if (deck.name.startsWith(top.name + separator)) {
          selectedIds.add(deck.id);
          break;
        }
      }
    }
  }

  return { selectedIds, selectedTops, effectiveFilter };
}

// ---------------------------------------------------------------------------
// Media.

function safeMediaName(name) {
  const raw = String(name ?? '');
  if (!raw || raw.includes('\u0000')) return null;

  const parts = raw.split(/[\\/]+/);
  if (parts.some((part) => part === '..')) return null;

  const base = parts[parts.length - 1].trim().replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  if (!base || base === '.' || base === '..') return null;
  return base;
}

function extractMedia(zip, mediaDir) {
  const stats = { extracted: 0, missing: 0, skipped: 0 };
  const mediaEntry = zip.entries.get('media');
  if (!mediaEntry) return stats;

  let mapping;
  try {
    mapping = JSON.parse(zip.read(mediaEntry).toString('utf8'));
  } catch {
    console.warn('⚠ media 映射不是有效 JSON，跳过媒体文件提取。');
    return stats;
  }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    console.warn('⚠ media 映射格式无法识别，跳过媒体文件提取。');
    return stats;
  }

  mkdirSync(mediaDir, { recursive: true });
  const written = new Set();
  const root = resolve(mediaDir);

  for (const [zipName, original] of Object.entries(mapping)) {
    const safe = safeMediaName(original);
    if (!safe) { stats.skipped++; continue; }

    const key = process.platform === 'win32' ? safe.toLowerCase() : safe;
    if (written.has(key)) { stats.skipped++; continue; }

    const blobEntry = zip.entries.get(String(zipName));
    if (!blobEntry) { stats.missing++; continue; }

    const target = resolve(root, safe);
    if (target !== join(root, safe) || !target.startsWith(root + sep)) {
      stats.skipped++;
      continue;
    }

    writeFileSync(target, zip.read(blobEntry));
    written.add(key);
    stats.extracted++;
  }

  return stats;
}

// ---------------------------------------------------------------------------

const levelRank = (level) => {
  const index = DISPLAY_ORDER.indexOf(level);
  return index < 0 ? DISPLAY_ORDER.length : index;
};

const compareWords = (a, b) =>
  levelRank(a.grade) - levelRank(b.grade) ||
  a.grade.localeCompare(b.grade) ||
  a.word.localeCompare(b.word, 'en', { sensitivity: 'base' }) ||
  a.id.localeCompare(b.id);

const main = () => {
  const args = parseArgs(process.argv.slice(2));

  const apkgPath = resolve(process.cwd(), args.file);
  if (!existsSync(apkgPath) || !statSync(apkgPath).isFile()) {
    fail(`找不到 .apkg 文件：${apkgPath}`);
  }

  const outDir = resolve(ROOT, args.out);
  if (outDir !== DATA_ROOT && !outDir.startsWith(DATA_ROOT + sep)) {
    fail(`--out 只能指向项目内的 data/ 目录（收到：${outDir}）。`);
  }

  const zip = readZip(apkgPath);
  let tempDir = null;

  try {
    const entryNames = [...zip.entries.keys()];

    if (zip.entries.has('collection.anki21b')) {
      fail(
        '该 .apkg 使用新版 collection.anki21b（zstd 压缩），本工具不实现 zstd。\n' +
        '请在 Anki 中重新导出，并勾选「支持旧版 Anki / Support older Anki versions」，\n' +
        '让压缩包内包含 collection.anki2 后再导入。',
      );
    }

    const collectionName = zip.entries.has('collection.anki21')
      ? 'collection.anki21'
      : zip.entries.has('collection.anki2')
        ? 'collection.anki2'
        : null;
    if (!collectionName) {
      fail(`压缩包内找不到 collection.anki2 / collection.anki21。实际条目：${entryNames.join(', ')}`);
    }

    const collection = zip.read(collectionName);
    if (collection.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') {
      fail(`${collectionName} 不是 SQLite 数据库，无法导入。`);
    }

    tempDir = mkdtempSync(join(tmpdir(), 'raz-apkg-'));
    const dbPath = join(tempDir, 'collection.db');
    writeFileSync(dbPath, collection);

    const { models, decks: decksJson, notes, cards } = readCollection(dbPath);

    const model = findModel(models);
    const modelId = String(model.id ?? '');
    const fieldIndices = buildFieldIndices(model);

    const decks = Object.entries(decksJson || {}).map(([key, value]) => ({
      id: String(value?.id ?? key),
      name: String(value?.name ?? ''),
    }));
    const deckById = new Map(decks.map((deck) => [deck.id, deck.name]));

    const { selectedIds, selectedTops, effectiveFilter } = selectDecks(decks, args.deck);
    if (selectedIds.size === 0) fail('没有选中任何牌组，无法导入。');

    const cardsByNote = new Map();
    for (const card of cards) {
      const nid = String(card.nid);
      const list = cardsByNote.get(nid);
      if (list) list.push(String(card.did));
      else cardsByNote.set(nid, [String(card.did)]);
    }

    const seen = new Set();
    const usedDeckIds = new Set();
    const words = [];
    const skipped = { noCard: 0, otherModel: 0, emptyWord: 0, duplicate: 0 };

    for (const note of notes) {
      const id = String(note.id);
      if (seen.has(id)) { skipped.duplicate++; continue; }

      const dids = cardsByNote.get(id) || [];
      const deckId = dids.find((did) => selectedIds.has(did));
      if (!deckId) { skipped.noCard++; continue; }

      if (modelId && String(note.mid) !== modelId) { skipped.otherModel++; continue; }
      seen.add(id);

      const rawFields = String(note.flds ?? '').split('\x1f');
      const flds = fieldIndices.map((index) =>
        index >= 0 && index < rawFields.length ? rawFields[index] : '');

      const normalized = normalizeNote({
        id,
        guid: String(note.guid ?? ''),
        did: deckId,
        flds,
      });

      if (!normalized.word) { skipped.emptyWord++; continue; }

      words.push(normalized);
      usedDeckIds.add(deckId);
    }

    words.sort(compareWords);

    const levelCounts = new Map();
    for (const word of words) {
      const level = word.grade || '未分级';
      levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
    }
    const levels = [...levelCounts.keys()].sort(
      (a, b) => levelRank(a) - levelRank(b) || a.localeCompare(b),
    );

    const importedDecks = [...usedDeckIds]
      .map((deckId) => deckById.get(deckId))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const report = {
      source: basename(apkgPath),
      importedAt: new Date().toISOString(),
      deckFilter: effectiveFilter,
      topDecks: selectedTops.map((deck) => deck.name),
      decks: importedDecks,
      levelOrder: levels,
      levelCounts: Object.fromEntries(levels.map((level) => [level, levelCounts.get(level)])),
      totalWords: words.length,
    };

    mkdirSync(outDir, { recursive: true });
    const mediaStats = extractMedia(zip, join(outDir, 'media'));

    writeFileSync(join(outDir, 'words.full.json'), JSON.stringify(words, null, 2), 'utf8');
    writeFileSync(join(outDir, 'deck.imported.json'), JSON.stringify(report, null, 2), 'utf8');

    const skipParts = Object.entries(skipped)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => `${key}:${count}`);
    console.log(`notes: ${notes.length} 读取, ${words.length} 保留${skipParts.length ? ` (跳过 ${skipParts.join(', ')})` : ''}`);
    console.log(`media: ${mediaStats.extracted} 个文件提取${mediaStats.missing ? `, ${mediaStats.missing} 个缺失` : ''}${mediaStats.skipped ? `, ${mediaStats.skipped} 个跳过` : ''}`);
    console.log(`levels: ${levels.map((level) => `${level}:${levelCounts.get(level)}`).join(', ')}`);
    console.log(`decks: ${importedDecks.join(' | ') || '(无)'}`);
    console.log(`written: ${join(outDir, 'words.full.json')}`);
    console.log(`written: ${join(outDir, 'deck.imported.json')}`);
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    zip.close();
  }
};

try {
  main();
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}
