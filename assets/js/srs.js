/* Spaced-repetition progress stored in localStorage (no backend, no build). */
(function () {
  const KEY = 'raz.srs.v1';
  const DAY = 86400000;
  const BOX_DAYS = [0, 1, 2, 4, 7, 15, 30, 60, 120];

  const defaults = () => ({
    v: 1,
    settings: { autoplay: true, theme: 'light', shuffle: false, newPerDay: 30 },
    words: {},
    days: {},
  });

  const todayKey = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  let state;
  try {
    state = JSON.parse(localStorage.getItem(KEY) || 'null') || defaults();
  } catch {
    state = defaults();
  }
  state.settings = Object.assign(defaults().settings, state.settings || {});
  state.words = state.words || {};
  state.days = state.days || {};

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  };

  const entry = (id) => {
    if (!state.words[id]) state.words[id] = { box: -1, due: 0, seen: 0, right: 0, wrong: 0, lapses: 0, last: 0 };
    return state.words[id];
  };

  const today = () => state.days[todayKey()] || { studied: 0, right: 0, wrong: 0, levels: {} };

  const bumpDay = (grade, level) => {
    const d = (state.days[todayKey()] ||= { studied: 0, right: 0, wrong: 0, levels: {} });
    d.studied += 1;
    if (grade === 'again') d.wrong += 1;
    else d.right += 1;
    d.levels[level] = (d.levels[level] || 0) + 1;
    state.lastDay = todayKey();
    save();
  };

  // grade: 'again' | 'good' | 'easy'
  const rate = (word, grade) => {
    const e = entry(word.id);
    e.seen += 1;
    e.last = Date.now();
    if (grade === 'again') {
      e.lapses += 1;
      e.wrong += 1;
      e.box = 0;
      e.due = Date.now() + 5 * 60000; // back later in the session
    } else if (grade === 'easy') {
      e.right += 1;
      e.box = Math.min(e.box + 2, BOX_DAYS.length - 1);
      e.due = Date.now() + BOX_DAYS[e.box] * DAY;
    } else {
      e.right += 1;
      e.box = Math.min(Math.max(e.box, 0) + 1, BOX_DAYS.length - 1);
      e.due = Date.now() + BOX_DAYS[e.box] * DAY;
    }
    bumpDay(grade, word.grade);
    return e;
  };

  const wordState = (id) => state.words[id] || null;

  const isDue = (id, now = Date.now()) => {
    const e = state.words[id];
    return !!e && e.seen > 0 && e.due <= now;
  };

  const isNew = (id) => !state.words[id] || !state.words[id].seen;
  const isLearned = (id) => !!state.words[id] && state.words[id].box >= 3;

  // Queue for a level: due cards first, then new cards up to the daily limit,
  // then remaining unseen cards so a fresh session is never empty.
  const buildQueue = (words, { limit } = {}) => {
    const now = Date.now();
    const due = words.filter((w) => isDue(w.id, now));
    const fresh = words.filter((w) => isNew(w.id));
    const daily = limit || state.settings.newPerDay;
    const studiedToday = (state.days[todayKey()]?.studied || 0);
    const freshToday = Math.max(0, daily - studiedToday);
    const queue = [...due, ...fresh.slice(0, Math.max(freshToday, 1))];
    if (queue.length === 0) queue.push(...fresh.slice(0, Math.min(words.length, 10)));
    if (state.settings.shuffle) {
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }
    return queue;
  };

  const levelStats = (level, words) => {
    const ids = new Set(words.filter((w) => w.grade === level).map((w) => w.id));
    let seen = 0, learned = 0, due = 0;
    for (const id of ids) {
      const e = state.words[id];
      if (!e || !e.seen) continue;
      seen += 1;
      if (e.box >= 3) learned += 1;
      if (e.due <= Date.now()) due += 1;
    }
    return { total: ids.size, seen, learned, due };
  };

  const overall = (words) => {
    let seen = 0, learned = 0, due = 0, right = 0, wrong = 0;
    for (const w of words) {
      const e = state.words[w.id];
      if (e && e.seen) {
        seen += 1;
        right += e.right;
        wrong += e.wrong;
        if (e.box >= 3) learned += 1;
        if (e.due <= Date.now()) due += 1;
      }
    }
    return { total: words.length, seen, learned, due, accuracy: right + wrong ? Math.round((right / (right + wrong)) * 100) : null };
  };

  const streak = () => {
    let n = 0;
    const d = new Date();
    // A day with no reviews does not break the streak until a full day passes.
    if (!state.days[todayKey(d)]?.studied) d.setDate(d.getDate() - 1);
    while (state.days[todayKey(d)]?.studied) {
      n += 1;
      d.setDate(d.getDate() - 1);
    }
    return n;
  };

  const recent = (days = 7) => {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = todayKey(d);
      out.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, studied: state.days[key]?.studied || 0 });
    }
    return out;
  };

  const reset = () => {
    state = defaults();
    save();
  };

  window.RAZ_SRS = {
    get state() { return state; },
    settings: state.settings,
    save,
    updateSettings(patch) {
      Object.assign(state.settings, patch);
      save();
    },
    rate,
    wordState,
    isDue,
    isNew,
    isLearned,
    buildQueue,
    levelStats,
    overall,
    today,
    streak,
    recent,
    reset,
  };
})();
