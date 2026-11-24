/* Card markup for the RAZ deck, mirroring the original Anki template classes. */
(function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const audioBtn = (file, text, label, local) => {
    const tts = esc(text || '');
    return `<button class="audio-btn" type="button" data-audio="${esc(file || '')}" data-tts="${tts}" data-local="${esc(local || '')}" aria-label="播放发音">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      ${label ? `<span>${esc(label)}</span>` : ''}
    </button>`;
  };

  // Pre-generated neural audio (tools/build-audio.py) lives under audio/<LEVEL>/<word>.mp3;
  // sentence audio under audio/sent/<LEVEL>/<word>.mp3.
  const localAudio = (w, sent) => {
    if (!w || !w.grade || !w.word) return '';
    const seg = (s) => {
    const v = String(s);
    const n = encodeURIComponent(v);
    // Windows reserves device names (con, aux, ...); build-audio.py suffixes them too.
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(v) ? n + '_' : n;
  };
    return `audio/${sent ? 'sent/' : ''}${seg(w.grade)}/${seg(w.word)}.mp3`;
  };

  const plain = (html) =>
    String(html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();

  const photoPlaceholder = (w) =>
    `<div class="photo-ph" aria-hidden="true"><span class="ph-letter">${esc((w.word || '?')[0].toUpperCase())}</span><span class="ph-word">${esc(w.word)}</span></div>`;

  const photo = (w) => {
    const src = (w.images && w.images[0]) || '';
    const seed = window.RAZ_DATA?.meta?.source === 'seed';
    if (!src || seed) return photoPlaceholder(w);
    const f = /^https?:/i.test(src) ? src : 'data/media/' + src;
    return `<div class="photo"><img src="${esc(f)}" alt="${esc(w.word)}" loading="lazy"
      onerror="this.parentNode.classList.add('is-missing')">${photoPlaceholder(w)}</div>`;
  };

  const chn = (w) => `<div class="chn">${w.chn || ''}</div>`;

  const sentence = (w) => {
    if (!w.sentHtml) return '';
    return `<div class="phosen">${w.sentHtml}</div>
      ${audioBtn(w.sentAudio, plain(w.sentHtml), '例句', localAudio(w, true))}`;
  };

  const front = (w, mode) => {
    if (mode === 'dictation') {
      return `<div class="section1">
        <div class="dictation-hint">听音 / 看释义，写出单词</div>
        ${audioBtn(w.sentAudio || w.wordAudio, plain(w.sentHtml) || w.word, '听例句', localAudio(w, !!w.sentHtml))}
        <div class="section2 dict-meaning">${chn(w)}</div>
        <input class="dict-input" type="text" autocomplete="off" autocapitalize="off"
          autocorrect="off" spellcheck="false" placeholder="输入单词后回车">
      </div>`;
    }
    return `<div class="section1">
      <div class="word">${esc(w.word)}</div>
      ${w.ipa ? `<div class="symbol">${esc(w.ipa)}</div>` : ''}
      ${audioBtn(w.wordAudio, w.word, '', localAudio(w))}
    </div>`;
  };

  const reveal = (w, mode) => {
    const wordLine = (cls) => `<div class="${cls}">${esc(w.word)}</div>`;
    return `<div class="section1">
      ${wordLine(mode === 'dictation' ? 'word2' : 'word')}
      ${w.ipa ? `<div class="symbol">${esc(w.ipa)}</div>` : ''}
      ${audioBtn(w.wordAudio, w.word, '', localAudio(w))}
    </div>
    <div class="section2">${chn(w)}${w.note ? `<div class="extra7">${esc(w.note)}</div>` : ''}</div>
    <div class="section3">
      ${photo(w)}
      ${sentence(w)}
    </div>`;
  };

  const detail = (w) => `${reveal(w, 'browse')}`;

  window.CardRender = { front, reveal, detail, audioBtn, esc };
})();
