/* RAZ 词库 · no-build single page app */
(function () {
  const D = window.RAZ_DATA;
  const S = window.RAZ_SRS;
  const C = window.CardRender;
  const view = document.getElementById('view');
  const topbar = document.getElementById('topbar');
  const tabbar = document.getElementById('tabbar');
  const toastEl = document.getElementById('toast');

  const words = D.words || [];
  const meta = D.meta || {};
  const levels = (meta.levelOrder || []).map((label) => ({
    label,
    total: meta.levelCounts?.[label] || 0,
    words: words.filter((w) => w.grade === label),
  }));
  const byId = new Map(words.map((w) => [String(w.id), w]));
  const levelOf = (label) => levels.find((l) => l.label === label);
  const esc = C.esc;

  const state = {
    mode: localStorage.getItem('raz.mode') || 'memorize',
    selectedWord: null,
    dict: null,
    query: '',
    level: 'all',
  };
  let session = null;

  /* ---------- helpers ---------- */
  const todayLabel = () => {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };
  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
  };
  // Prefer a natural-sounding en-US voice when we must fall back to on-device TTS.
  let bestVoice = null;
  const pickVoice = () => {
    if (!('speechSynthesis' in window)) return;
    const en = speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
    bestVoice =
      en.find((v) => /natural|neural|online/i.test(v.name)) ||
      en.find((v) => /google us english|samantha|aria|jenny|libby|sonia|guy|davis/i.test(v.name)) ||
      en.find((v) => /^en[-_]US$/i.test(v.lang)) ||
      en[0] ||
      null;
  };
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  const speak = (text) => {
    if (!text || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1;
    if (bestVoice) u.voice = bestVoice;
    try {
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {}
  };
  // Online pronunciation: real dictionary recordings for words, neural TTS for sentences.
  const remoteVoiceUrl = (text) => {
    const t = String(text || '').trim();
    if (!t) return '';
    const short = t.split(/\s+/).length <= 3 && t.length <= 24;
    return short
      ? 'https://dict.youdao.com/dictvoice?type=2&audio=' + encodeURIComponent(t)
      : 'https://fanyi.baidu.com/gettts?lan=en&spd=3&source=web&text=' + encodeURIComponent(t);
  };
  let currentAudio = null;
  const playAudio = (file, fallbackText) => {
    const text = String(fallbackText || '').trim();
    const isFull = window.RAZ_DATA && window.RAZ_DATA.meta && window.RAZ_DATA.meta.source === 'full';
    const sources = [];
    if (file && isFull) sources.push('data/media/' + encodeURIComponent(file));
    const remote = remoteVoiceUrl(text);
    if (remote) sources.push(remote);
    if (currentAudio) {
      try {
        currentAudio.pause();
      } catch {}
    }
    const tryNext = (i) => {
      if (i >= sources.length) return speak(text);
      const a = new Audio(sources[i]);
      currentAudio = a;
      let failed = false;
      const fail = () => {
        if (failed) return;
        failed = true;
        tryNext(i + 1);
      };
      a.onerror = fail;
      a.play().catch(fail);
    };
    tryNext(0);
  };
  const progressPct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const plain = (html) =>
    String(html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const levelHasWords = (label) => (levelOf(label)?.words.length || 0) > 0;
  const firstStudyLevel = () => {
    const withWords = levels.filter((l) => l.words.length);
    if (!withWords.length) return null;
    const due = withWords.find((l) => S.levelStats(l.label, words).due > 0);
    return (due || withWords[0]).label;
  };

  /* ---------- router ---------- */
  const parseHash = () => {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    const params = new URLSearchParams(qs || '');
    const parts = path.split('/').filter(Boolean);
    return { view: parts[0] || 'home', parts, params };
  };

  const go = (hash) => {
    if (location.hash === hash) render();
    else location.hash = hash;
  };

  const render = () => {
    const route = parseHash();
    document.body.dataset.theme = S.settings.theme;
    const navKey = ['home', 'browse', 'stats'].includes(route.view) ? route.view : route.view === 'study' ? 'study' : '';
    [...tabbar.querySelectorAll('a')].forEach((a) => a.classList.toggle('active', a.dataset.tab === navKey));

    switch (route.view) {
      case 'study': return renderStudy(route);
      case 'browse': return renderBrowse(route);
      case 'stats': return renderStats();
      case 'settings': return renderSettings();
      default: return renderHome();
    }
  };

  const setTopbar = (html, { back = false, border = true } = {}) => {
    topbar.innerHTML = html;
    topbar.classList.toggle('with-back', back);
    topbar.classList.toggle('no-border', !border);
    topbar.hidden = false;
  };
  const frame = (body, cls = '') => {
    view.className = 'view ' + cls;
    view.innerHTML = body;
  };

  /* ---------- home ---------- */
  const renderHome = () => {
    const overall = S.overall(words);
    const due = levels.reduce((n, l) => n + S.levelStats(l.label, words).due, 0);
    const seedNote = meta.source === 'seed';
    const approxNote = meta.source === 'approx';
    setTopbar(`<div class="topbar-row">
        <div>
          <div class="topbar-kicker">RAZ AA–Z2 · 美音版</div>
          <h1 class="topbar-title">单词词库</h1>
        </div>
        <a class="icon-btn" href="#/settings" aria-label="设置">⚙</a>
      </div>`);

    const modeBtn = (mode, name, desc, count) => `
      <button class="mode-card ${state.mode === mode ? 'is-active' : ''}" data-act="mode" data-mode="${mode}">
        <span class="mode-name">${name}</span>
        <span class="mode-desc">${desc}</span>
        <span class="mode-count">${count.toLocaleString()} 张</span>
      </button>`;

    const levelChips = levels.map((l) => {
      const st = S.levelStats(l.label, words);
      const has = l.words.length > 0;
      return `<button class="level-cell ${has ? '' : 'is-empty'}" data-act="start" data-level="${l.label}" ${has ? '' : 'data-empty="1"'}>
        <span class="level-name">${l.label}</span>
        <span class="level-count">${has ? `${l.words.length} 词` : l.total ? `${l.total}` : '—'}</span>
        <span class="level-bar"><i style="width:${progressPct(st.learned, st.total)}%"></i></span>
      </button>`;
    }).join('');

    frame(`
      <section class="hero card">
        <div class="hero-main">
          <div class="hero-num">${(meta.decks?.[1]?.totalCard || meta.totalWords || 0).toLocaleString()}</div>
          <div class="hero-label">牌组总卡片</div>
        </div>
        <div class="hero-grid">
          <div><strong>${words.length.toLocaleString()}</strong><span>已导入</span></div>
          <div><strong>${overall.seen}</strong><span>已学</span></div>
          <div><strong>${due}</strong><span>待复习</span></div>
          <div><strong>${S.streak()}</strong><span>连续天数</span></div>
        </div>
        <button class="primary-btn" data-act="continue">开始今日学习</button>
      </section>

      ${seedNote ? `<a class="notice" href="#/settings">
        <strong>当前为公开预览数据</strong>
        <span>仅 20 张示例卡。导入自己合法持有的 .apkg 牌组后即可学习全部 ${(meta.decks?.[1]?.totalCard || 12918).toLocaleString()} 张卡片 →</span>
      </a>` : approxNote ? `<a class="notice" href="#/settings">
        <strong>当前为词频近似词库</strong>
        <span>${words.length.toLocaleString()} 个词按 ECDICT 词频近似分入 29 个级别，并非官方 RAZ 分级；要精确内容请导入自己购买的 .apkg →</span>
      </a>` : ''}

      <section class="block">
        <div class="block-head"><h2>学习模式</h2><span class="muted">${state.mode === 'memorize' ? '看词回忆释义' : '听音看义写单词'}</span></div>
        <div class="mode-row">
          ${modeBtn('memorize', '背诵版', '正面单词 · 背面释义', words.length)}
          ${modeBtn('dictation', '听写版', '提示释义 · 拼写单词', words.length)}
        </div>
      </section>

      <section class="block">
        <div class="block-head"><h2>按级别学习</h2><span class="muted">AA → Z2</span></div>
        <div class="level-grid">${levelChips}</div>
      </section>

      <section class="block">
        <div class="block-head"><h2>最近 7 天</h2><a class="link" href="#/stats">统计 →</a></div>
        ${bars(S.recent(7))}
      </section>
      <p class="footnote">${meta.source === 'approx'
        ? '词表来源：ECDICT（MIT 许可）按词频近似分级 · 仅供个人学习使用。'
        : `数据来源：Anki 记忆卡商店 · “${esc(meta.title || '')}”。仅供个人学习使用。`}</p>
    `, 'home');
  };

  const bars = (data) => {
    const max = Math.max(1, ...data.map((d) => d.studied));
    return `<div class="bars">${data
      .map(
        (d) => `<div class="bar"><span class="bar-val">${d.studied || ''}</span>
          <i style="height:${Math.max(4, (d.studied / max) * 54)}px"></i>
          <span class="bar-label">${d.label}</span></div>`,
      )
      .join('')}</div>`;
  };

  /* ---------- study ---------- */
  const startSession = (level, mode, { again = false } = {}) => {
    const lv = levelOf(level);
    if (!lv || !lv.words.length) {
      toast(level ? `${level} 级别暂无词条，导入完整牌组后可用` : '暂无可学习的词条');
      return;
    }
    const queue = again && session ? session.queue.filter((w) => w.grade === level) : S.buildQueue(lv.words);
    session = { level, mode, queue: [...queue], index: 0, revealed: false, right: 0, wrong: 0, typed: '' };
    state.mode = mode;
    localStorage.setItem('raz.mode', mode);
    go(`#/study/${mode}/${level}`);
    render();
  };

  const currentWord = () => (session ? session.queue[session.index] : null);

  const renderStudy = (route) => {
    const mode = route.parts[1] || state.mode;
    const level = route.parts[2] || firstStudyLevel();
    if (!session || session.mode !== mode || session.level !== level) {
      const lv = level && levelOf(level);
      if (!lv || !lv.words.length) {
        setTopbar(`<div class="topbar-row"><a class="icon-btn" href="#/" aria-label="返回">←</a><h1 class="topbar-title">学习</h1></div>`, { back: true });
        frame(`<div class="empty"><div class="empty-emoji">📭</div><h2>该级别暂无词条</h2>
          <p>当前数据源为公开预览（20 张卡）。在「设置 → 导入完整牌组」中导入自己合法持有的 .apkg 后即可学习全部卡片。</p>
          <a class="primary-btn" href="#/settings">查看导入方法</a></div>`);
        return;
      }
      session = { level, mode, queue: S.buildQueue(lv.words), index: 0, revealed: false, right: 0, wrong: 0 };
    }

    const w = currentWord();
    if (!w) return renderDone();

    const total = session.queue.length;
    const idx = session.index + 1;
    setTopbar(`<div class="topbar-row study-bar">
        <a class="icon-btn" href="#/" aria-label="退出学习">✕</a>
        <div class="study-meta"><strong>${esc(session.level)}</strong><span>${mode === 'memorize' ? '背诵' : '听写'} · ${idx}/${total}</span></div>
        <div class="study-score"><span>✓ ${session.right}</span><span>✗ ${session.wrong}</span></div>
      </div>
      <div class="thin-progress"><i style="width:${progressPct(session.index, total)}%"></i></div>`, { back: true, border: false });

    const body = session.revealed ? C.reveal(w, mode) : C.front(w, mode);
    frame(`
      <div class="study-wrap">
        <div class="card study-card deck ${session.revealed ? 'is-revealed' : ''}" id="study-card">${body}</div>
        <div class="dict-result" id="dict-result"></div>
      </div>
      <div class="study-actions">
        ${
          session.revealed
            ? `<div class="rate-row">
                <button class="rate again" data-act="rate" data-grade="again"><b>忘记</b><small>1</small></button>
                <button class="rate good" data-act="rate" data-grade="good"><b>一般</b><small>2</small></button>
                <button class="rate easy" data-act="rate" data-grade="easy"><b>掌握</b><small>3</small></button>
              </div>`
            : mode === 'dictation'
              ? `<button class="primary-btn" data-act="check">检查拼写</button>
                 <button class="ghost-btn" data-act="reveal">直接看答案</button>`
              : `<button class="primary-btn" data-act="reveal">显示答案 <small>空格</small></button>`
        }
      </div>
    `, 'study');

    const input = view.querySelector('.dict-input');
    const cardEl = view.querySelector('#study-card');
    cardEl?.addEventListener('click', (e) => {
      if (e.target.closest('button, input, a')) return;
      if (!session.revealed) {
        session.revealed = true;
        session.lastCheck = null;
        render();
      }
    });
    if (input) {
      input.value = session.typed || '';
      setTimeout(() => input.focus(), 30);
      input.addEventListener('input', () => (session.typed = input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          checkDictation();
        }
      });
      const res = view.querySelector('#dict-result');
      if (session.lastCheck) paintCheck(res, w, session.lastCheck);
    } else if (S.settings.autoplay) {
      setTimeout(() => {
        const btn = view.querySelector('.audio-btn');
        if (btn) btn.click();
      }, 120);
    }
  };

  const paintCheck = (el, w, result) => {
    if (!el) return;
    const answer = w.word;
    const typed = result === 'ok' ? answer : session.typed;
    const diff = [...answer].map((ch, i) => {
      const t = (typed || '')[i];
      const cls = t === undefined ? 'miss' : t.toLowerCase() === ch.toLowerCase() ? 'hit' : 'bad';
      return `<span class="ch ${cls}">${esc(t || '·')}</span>`;
    }).join('');
    el.className = 'dict-result ' + (result === 'ok' ? 'ok' : 'bad');
    el.innerHTML = `<div class="dict-verdict">${result === 'ok' ? '✓ 拼写正确' : '✗ 再想想'}</div>
      <div class="dict-diff">${answer.length <= 20 ? diff : esc(typed)}</div>`;
  };

  const checkDictation = () => {
    const w = currentWord();
    if (!w) return;
    const typed = (view.querySelector('.dict-input')?.value || session.typed || '').trim();
    session.typed = typed;
    const ok = typed.toLowerCase().replace(/[^a-z'\- ]/g, '') === w.word.toLowerCase();
    session.lastCheck = ok ? 'ok' : 'bad';
    paintCheck(view.querySelector('#dict-result'), w, session.lastCheck);
    if (ok) {
      session.revealed = true;
      const card = view.querySelector('#study-card');
      const input = view.querySelector('.dict-input');
      if (input) input.disabled = true;
      // Keep the typed answer visible, reveal the card content below it.
      card.insertAdjacentHTML('beforeend', `<div class="dict-answer">${C.esc(w.word)}</div>`);
      setTimeout(() => render(), 520);
    } else {
      view.querySelector('.dict-input')?.focus();
    }
  };

  const grade = (g) => {
    const w = currentWord();
    if (!w) return;
    S.rate(w, g);
    if (g === 'again') {
      session.queue.push(w);
      session.wrong += 1;
    } else if (g === 'easy') session.right += 1;
    else session.right += 1;
    session.index += 1;
    session.revealed = false;
    session.typed = '';
    session.lastCheck = null;
    render();
  };

  const renderDone = () => {
    const n = session.queue.length;
    const acc = session.right + session.wrong ? Math.round((session.right / (session.right + session.wrong)) * 100) : 0;
    setTopbar(`<div class="topbar-row"><a class="icon-btn" href="#/" aria-label="返回">✕</a><h1 class="topbar-title">本组完成</h1></div>`, { back: true });
    frame(`<div class="done">
      <div class="done-emoji">🎉</div>
      <h2>完成 ${n} 张卡片</h2>
      <p class="muted">正确率 ${acc}% · 共 ${session.right + session.wrong} 次作答</p>
      <div class="done-stats"><div><strong>${session.right}</strong><span>掌握</span></div><div><strong>${session.wrong}</strong><span>忘记</span></div></div>
      <button class="primary-btn" data-act="again">再来一组</button>
      <a class="ghost-btn" href="#/">返回词库</a>
    </div>`);
  };

  /* ---------- browse ---------- */
  const renderBrowse = (route) => {
    const levelParam = route.params.get('level') || state.level;
    state.level = levelParam;
    const chips = ['all', ...levels.filter((l) => l.words.length).map((l) => l.label)];
    const shown = levels.find((l) => l.label === state.level)?.words || words;
    setTopbar(`<div class="topbar-row">
      <div><div class="topbar-kicker">词条浏览</div><h1 class="topbar-title">${words.length.toLocaleString()} 个词条</h1></div>
      <a class="icon-btn" href="#/settings" aria-label="设置">⚙</a>
    </div>`);
    frame(`
      <div class="search-wrap"><input id="search" class="search" type="search" placeholder="搜索单词或中文释义" value="${esc(state.query)}" autocomplete="off"></div>
      <div class="chip-row">${chips
        .map((c) => `<button class="chip ${state.level === c ? 'active' : ''}" data-act="filter" data-level="${c}">${c === 'all' ? '全部' : c}</button>`)
        .join('')}</div>
      <div id="word-list" class="word-list"></div>`);

    const paint = () => {
      const q = state.query.trim().toLowerCase();
      const rows = shown.filter((w) => !q || w.word.toLowerCase().includes(q) || w.chn.replace(/<[^>]+>/g, '').includes(q));
      const list = view.querySelector('#word-list');
      list.innerHTML = rows.length
        ? rows.slice(0, 400).map((w) => {
            const st = S.wordState(w.id);
            return `<button class="word-row" data-act="open" data-id="${w.id}">
              <span class="word-main"><span class="word-en">${esc(w.word)}</span>${w.ipa ? `<span class="word-ipa">${esc(w.ipa)}</span>` : ''}
                ${st && st.seen ? `<span class="dot ${st.box >= 3 ? 'learned' : ''}"></span>` : ''}</span>
              <span class="word-chn">${w.chn.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}</span>
            </button>`;
          }).join('')
        : `<div class="empty small"><div class="empty-emoji">🔍</div><p>没有匹配的词条</p></div>`;
    };
    paint();
    const input = view.querySelector('#search');
    input.addEventListener('input', () => {
      state.query = input.value;
      paint();
    });
  };

  const openWord = (id) => {
    const w = byId.get(String(id));
    if (!w) return;
    state.selectedWord = w;
    const sheet = document.getElementById('sheet');
    sheet.innerHTML = `<div class="sheet-panel">
      <button class="sheet-close" data-act="close-sheet" aria-label="关闭">✕</button>
      <div class="sheet-body deck">${C.detail(w)}</div>
      <div class="sheet-dict" id="sheet-dict"></div>
      <div class="sheet-actions">
        <a class="ghost-btn" href="#/study/memorize/${w.grade}" data-act="close-sheet">背这张</a>
        <a class="primary-btn" href="#/study/dictation/${w.grade}" data-act="close-sheet">听写这张</a>
      </div>
    </div>`;
    sheet.classList.add('open');
    loadDictionary(w);
    if (S.settings.autoplay) setTimeout(() => sheet.querySelector('.audio-btn')?.click(), 150);
  };

  const loadDictionary = async (w) => {
    const box = document.getElementById('sheet-dict');
    if (!box || !location.protocol.startsWith('http')) return;
    try {
      const res = await fetch(`data/dict/${w.grade}.json`);
      if (!res.ok) return;
      const entries = await res.json();
      const hit = entries.find((e) => e.word === w.word);
      if (!hit) return;
      box.innerHTML = `<details class="dict-box"><summary>剑桥词典释义</summary><div class="dictionary">${hit.html}</div></details>`;
    } catch {}
  };

  /* ---------- stats ---------- */
  const renderStats = () => {
    const o = S.overall(words);
    const t = S.today();
    setTopbar(`<div class="topbar-row"><div><div class="topbar-kicker">学习记录</div><h1 class="topbar-title">统计</h1></div></div>`);
    const levelRows = levels
      .filter((l) => l.words.length)
      .map((l) => {
        const st = S.levelStats(l.label, words);
        return `<div class="stat-level">
          <div class="stat-level-head"><strong>${l.label}</strong><span>${st.seen}/${st.total} 已学 · ${st.learned} 掌握</span></div>
          <div class="track"><i style="width:${progressPct(st.seen, st.total)}%"></i><b style="width:${progressPct(st.learned, st.total)}%"></b></div>
        </div>`;
      }).join('');
    frame(`
      <section class="card stat-hero">
        <div><strong>${S.streak()}</strong><span>连续学习天数</span></div>
        <div><strong>${t.studied}</strong><span>今日学习</span></div>
        <div><strong>${o.accuracy == null ? '—' : o.accuracy + '%'}</strong><span>总正确率</span></div>
      </section>
      <section class="block"><div class="block-head"><h2>最近 7 天</h2></div>${bars(S.recent(7))}</section>
      <section class="block"><div class="block-head"><h2>各级别进度</h2><span class="muted">${o.learned}/${o.total} 已掌握</span></div>
        ${levelRows || '<p class="muted pd-15">暂无词条。</p>'}</section>
      <section class="block"><div class="block-head"><h2>掌握分布</h2></div>${distribution(o, words)}</section>
    `);
  };

  const distribution = (o, list) => {
    const boxes = [0, 0, 0, 0, 0];
    for (const w of list) {
      const e = S.wordState(w.id);
      if (!e || !e.seen) continue;
      boxes[Math.min(4, Math.max(0, e.box))] += 1;
    }
    const labels = ['新学', '1–2 天', '3–7 天', '2–4 周', '长期'];
    const max = Math.max(1, ...boxes);
    return `<div class="dist">${boxes
      .map((n, i) => `<div class="dist-row"><span>${labels[i]}</span><div class="track"><i style="width:${(n / max) * 100}%"></i></div><b>${n}</b></div>`)
      .join('')}</div>`;
  };

  /* ---------- settings ---------- */
  const renderSettings = () => {
    const s = S.settings;
    const toggle = (key, name, desc) => `<label class="setting-row">
      <span><strong>${name}</strong><small>${desc}</small></span>
      <input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''}>
      <i class="switch"></i></label>`;
    setTopbar(`<div class="topbar-row"><a class="icon-btn" href="#/" aria-label="返回">←</a><h1 class="topbar-title">设置</h1></div>`, { back: true });
    frame(`
      <section class="block card block-pad">
        ${toggle('autoplay', '自动播放发音', '进入卡片时自动朗读单词')}
        ${toggle('shuffle', '乱序学习', '每次学习随机打乱队列')}
        <label class="setting-row"><span><strong>每日新词上限</strong><small>超过后优先复习到期卡片</small></span>
          <select id="newPerDay" class="select">
            ${[10, 20, 30, 50, 100].map((n) => `<option value="${n}" ${s.newPerDay === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select></label>
        <label class="setting-row"><span><strong>深色模式</strong><small>夜间护眼配色</small></span>
          <input type="checkbox" data-setting="theme" data-kind="theme" ${s.theme === 'dark' ? 'checked' : ''}>
          <i class="switch"></i></label>
      </section>

      <section class="block" id="import">
        <div class="block-head"><h2>导入完整牌组</h2></div>
        <div class="card block-pad prose">
          <p>公开接口只提供 20 张预览卡，完整 12,918 张需要导入你自己合法购买的 <code>.apkg</code> 牌组（Anki 导出时选择「支持旧版 Anki」）。</p>
          <ol>
            <li>把牌组文件放到项目根目录，例如 <code>raz.apkg</code></li>
            <li>运行 <code>node tools/import-apkg.mjs raz.apkg</code></li>
            <li>再运行 <code>node tools/build-data.mjs</code></li>
            <li>刷新本页即可看到全部词条（图片/音频自动拷到 <code>data/media/</code>）</li>
          </ol>
          <p class="muted small">当前数据源：${meta.source === 'full' ? '完整导入' : meta.source === 'approx' ? '词频近似（非官方分级）' : '公开预览（20 张）'} · 构建于 ${new Date(meta.builtAt).toLocaleString()}</p>
        </div>
      </section>

      <section class="block">
        <div class="block-head"><h2>数据</h2></div>
        <div class="card block-pad">
          <button class="ghost-btn wide danger" data-act="reset">清除全部学习进度</button>
          <p class="muted small">进度仅保存在本机浏览器 localStorage，不会上传。牌组内容版权归原作者所有，仅供个人学习。</p>
        </div>
      </section>
    `);

    view.querySelectorAll('[data-setting]').forEach((el) => {
      el.addEventListener('change', () => {
        const key = el.dataset.setting;
        if (key === 'theme') S.updateSettings({ theme: el.checked ? 'dark' : 'light' });
        else S.updateSettings({ [key]: el.checked });
        document.body.dataset.theme = S.settings.theme;
      });
    });
    view.querySelector('#newPerDay')?.addEventListener('change', (e) => S.updateSettings({ newPerDay: Number(e.target.value) }));
  };

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => {
    const audio = e.target.closest('[data-audio], [data-tts]');
    if (audio && audio.classList.contains('audio-btn')) {
      e.preventDefault();
      playAudio(audio.dataset.audio, audio.dataset.tts);
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'mode') {
      state.mode = el.dataset.mode;
      document.querySelectorAll('.mode-card').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === state.mode));
      localStorage.setItem('raz.mode', state.mode);
    } else if (act === 'continue') {
      const lv = firstStudyLevel();
      lv ? startSession(lv, state.mode) : toast('暂无可学习的词条');
    } else if (act === 'start') {
      if (el.dataset.empty) return toast(`${el.dataset.level} 级别暂无词条，导入完整牌组后可用`);
      startSession(el.dataset.level, state.mode);
    } else if (act === 'reveal') {
      session.revealed = true;
      session.lastCheck = null;
      render();
    } else if (act === 'check') {
      checkDictation();
    } else if (act === 'rate') {
      grade(el.dataset.grade);
    } else if (act === 'again') {
      startSession(session.level, session.mode, { again: true });
    } else if (act === 'filter') {
      state.level = el.dataset.level;
      go(`#/browse${state.level === 'all' ? '' : '?level=' + state.level}`);
      render();
    } else if (act === 'open') {
      openWord(el.dataset.id);
    } else if (act === 'close-sheet') {
      document.getElementById('sheet').classList.remove('open');
    } else if (act === 'reset') {
      if (confirm('确定清除全部学习进度？此操作不可撤销。')) {
        S.reset();
        toast('学习进度已清除');
        render();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    const route = parseHash();
    if (route.view !== 'study') return;
    const typing = e.target.matches('input, textarea, select');
    if (typing && e.key !== 'Escape') return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (!session) return;
      if (!session.revealed) {
        e.preventDefault();
        if (session.mode === 'dictation') checkDictation();
        else {
          session.revealed = true;
          render();
        }
      }
      return;
    }
    if (['1', '2', '3'].includes(e.key) && session?.revealed) {
      grade({ 1: 'again', 2: 'good', 3: 'easy' }[e.key]);
    }
    if (e.key === 'Escape') go('#/');
  });

  document.getElementById('sheet').addEventListener('click', (e) => {
    if (e.target.id === 'sheet') document.getElementById('sheet').classList.remove('open');
  });

  window.addEventListener('hashchange', render);
  render();
})();
