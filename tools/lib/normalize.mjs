// Shared normalization helpers for RAZ deck data.
//
// Used by both tools/extract-public.mjs (public API preview) and
// tools/import-apkg.mjs (own .apkg export). Keeping the mapping in one place
// guarantees that an imported deck and the public preview produce identical
// JSON shapes.

// Mirror of the deck template's colorMap: colour the part-of-speech tags.
export const POS_COLORS = {
  'n.': '#86c440', 'a.': '#f8b002', 'adj.': '#727272', 'ad.': '#684b9d',
  'adv.': '#684b9d', 'v.': '#479cdf', 'vi.': '#3e480d', 'vt.': '#3e480d',
  'prep.': '#04B7C9', 'conj.': '#04B7C9', 'pron.': '#04B7C9', 'art.': '#04B7C9',
  'num.': '#04B7C9', 'int.': '#04B7C9', 'interj.': '#04B7C9', 'modal.': '#04B7C9',
  'aux.': '#04B7C9', 'pl.': '#D111D3', 'abbr.': '#D111D3',
};

// Canonical level order used by the app. 0AA is the internal key, AA the label.
export const LEVEL_ORDER = ['0AA', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Z1', 'Z2'];

export const levelLabel = (key) => (key === '0AA' ? 'AA' : key);

export const stripTags = (html) =>
  String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

export const sounds = (field) =>
  [...String(field || '').matchAll(/\[sound:([^\]]+)\]/g)].map((m) => m[1]);

export const images = (html) =>
  [...String(html || '').matchAll(/<img[^>]+src=["']?([^"'\s>]+)/gi)].map((m) => m[1]);

const POS_TAG_ANCHOR = /<a\b[^>]*>[\s\S]*?<\/a>/gi;

export function decorateChn(chn) {
  // Notes exported from Anki already contain decorated <a class="pos-tag">
  // anchors, unlike the public preview payload. Park those anchors first so the
  // regex below never wraps a token twice (which would nest anchors).
  const parked = [];
  const html = String(chn || '').replace(POS_TAG_ANCHOR, (match) => {
    if (!/\bpos-tag\b/i.test(match.slice(0, match.indexOf('>') + 1))) return match;
    return `\u0000${parked.push(match) - 1}\u0000`;
  });

  return html
    .replace(/(?<![A-Za-z])([a-z]+\.)/g, (tag) => {
      const color = POS_COLORS[tag];
      if (!color) return tag;
      return `<a class="pos-tag" style="background-color:${color}">${tag}</a>`;
    })
    .replace(/\u0000(\d+)\u0000/g, (_, i) => parked[Number(i)]);
}

// Expects `note.flds` to be an 11-slot array in canonical order. The importer
// builds that array by mapping Anki field names; the public API already returns
// fields positionally.
export function normalizeNote(note) {
  const f = note.flds || [];
  const photoHtml = f[5] || '';
  const sentHtml = f[6] || '';
  return {
    id: note.id,
    guid: note.guid,
    deckId: note.did,
    grade: levelLabel(stripTags(f[0])),
    note: f[1] || '',
    word: stripTags(f[2]),
    chn: decorateChn(f[3] || ''),
    ipa: stripTags(f[4]),
    photoHtml,
    images: images(photoHtml),
    sentHtml,
    wordAudio: sounds(f[8])[0] || sounds(f[7])[0] || '',
    sentAudio: sounds(f[7])[0] || '',
    extraAudio: sounds(f[8]).slice(1),
    photo2: f[9] || '',
    dictionary: f[10] || '',
  };
}
