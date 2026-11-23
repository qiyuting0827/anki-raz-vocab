// Pull the public card-detail payload + deck model (templates/CSS) from the
// Anki 记忆卡商店 API and normalize it into this project's data format.
//
//   node tools/extract-public.mjs
//
// Outputs: data/deck.json, data/words.seed.json
// The public preview only exposes 20 cards; see README for importing a full deck.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTags, normalizeNote, LEVEL_ORDER, levelLabel } from './lib/normalize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://file.ankichinas.cn/server/api/';
const CARD_ID = '62d65fa0acdacScy';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

const get = async (path) => {
  const res = await fetch(API + path, { headers: HEADERS });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`${path} -> ${json.code} ${json.message}`);
  return json.data;
};

const main = async () => {
  const detail = await get(`card/detail?cardId=${CARD_ID}`);
  const { card, allDecks, preview } = detail;

  // Deck tree: two top-level decks (背诵 / 听写), each with 29 level children.
  const decks = Object.entries(allDecks).map(([name, deck]) => ({
    name,
    deckId: deck.id ?? null,
    totalCard: deck.totalCard,
    children: Object.entries(deck.decks || {}).map(([key, child]) => ({
      key,
      label: levelLabel(key),
      deckId: child.id,
      count: child.totalCard,
      name: child.name,
    })),
  }));

  // Model comes from the same endpoint the card viewer uses.
  const meta = await get(`card/getStudyData2?did=${decks[0].children[0].deckId}&card_id=${CARD_ID}`);
  const models = Object.values(meta.models || {});
  const model = models.find((m) => (m.flds || []).some((f) => /word/i.test(f.name))) || models[0];

  const levelCounts = {};
  for (const deck of decks) {
    for (const child of deck.children) {
      levelCounts[child.label] = Math.max(levelCounts[child.label] || 0, child.count);
    }
  }

  const deck = {
    cardId: CARD_ID,
    title: card.title,
    subtitle: card.contentDesc ? stripTags(card.contentDesc) : '',
    price: card.price,
    cardCount: card.cardCount,
    totalWords: 6500,
    levelCounts,
    levelOrder: LEVEL_ORDER.map(levelLabel),
    decks,
    model: {
      name: model.name,
      fields: (model.flds || []).map((f) => f.name),
      templates: (model.tmpls || []).map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
      css: model.css,
    },
    source: {
      api: API + `card/detail?cardId=${CARD_ID}`,
      fetchedAt: new Date().toISOString(),
      note: '公开接口仅返回 20 张预览卡；完整词库需导入自己合法持有的 .apkg 牌组。',
    },
  };

  const words = (preview?.cardList || []).map(normalizeNote);

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(join(ROOT, 'data/deck.json'), JSON.stringify(deck, null, 2), 'utf8');
  writeFileSync(join(ROOT, 'data/words.seed.json'), JSON.stringify(words, null, 2), 'utf8');

  console.log(`deck: ${decks.length} decks, ${deck.levelOrder.length} levels`);
  console.log(`seed: ${words.length} preview cards`);
  console.log(words.map((w) => `${w.grade}\t${w.word}\t${w.chn.replace(/<[^>]+>/g, '').slice(0, 24)}`).join('\n'));
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
