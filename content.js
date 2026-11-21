/* Runs only on the HFUT-CS-Online host; never injects code into the site's JS world. */
(async function () {
  'use strict';
  const S = globalThis.HFUTNetSync;
  if (!S) return;

  let state = null;
  let locked = Promise.resolve();
  let snapshotPending = false;
  let timer = null;
  let readingTimer = null;
  let readingLastSaved = 0;
  let lastChapter = null;
  let lastError = null;

  const serial = (fn) => {
    locked = locked.catch(() => {}).then(fn).catch((e) => {
      lastError = e?.message || String(e);
      console.warn('[HFUT Net Sync]', lastError);
      chrome.storage.local.set({ [S.PREFIX + 'last_error']: lastError }).catch(() => {});
    });
    return locked;
  };
  const siteAnswers = () => {
    try { return S.parseSiteAnswers(localStorage.getItem(S.SITE_KEY)); }
    catch { return {}; }
  };
  const practiceRoute = () => /^#\/net\/practice(?:\/|\?|$)/.test(location.hash);
  const currentChapter = () => location.hash.match(/^#\/net\/deck\/(ch[1-7])(?:\?|$)/)?.[1] ?? null;
  const persist = async () => {
    if (!state) return;
    await chrome.storage.local.set({ [S.DEVICE_STATE_KEY]: state });
  };

  async function absorbCloud() {
    const cloud = await chrome.storage.sync.get(null);
    state.records = S.mergeRecords(state.records, S.cloudAnswers(cloud));
    state.reading = S.mergeReading(state.reading, cloud[S.READING_KEY]?.entries);
    return cloud;
  }

  async function pushCloud(cloud) {
    const latest = cloud || await chrome.storage.sync.get(null);
    state.records = S.mergeRecords(state.records, S.cloudAnswers(latest));
    state.reading = S.mergeReading(state.reading, latest[S.READING_KEY]?.entries);
    const grouped = S.splitPapers(state.records);
    const changes = {};
    for (const [paper, entries] of Object.entries(grouped)) {
      const key = S.ANSWER_PREFIX + paper;
      const existing = S.sanitizeRecords(latest[key]?.entries);
      if (S.canonical(entries) !== S.canonical(existing)) {
        const item = { version: 1, entries };
        // sync has a per-item limit of 8 KiB; never discard records silently.
        if (new TextEncoder().encode(JSON.stringify(item)).length > 7500) {
          throw new Error(`${paper} 数据超过浏览器同步限制，请先导出备份`);
        }
        changes[key] = item;
      }
    }
    if (S.canonical(state.reading) !== S.canonical(S.cleanReading(latest[S.READING_KEY]?.entries))) {
      changes[S.READING_KEY] = { version: 1, entries: state.reading };
    }
    if (Object.keys(changes).length) await chrome.storage.sync.set(changes);
    await persist();
    lastError = null;
    await chrome.storage.local.set({ [S.PREFIX + 'last_success']: Date.now(), [S.PREFIX + 'last_error']: '' });
  }

  function applyCloudToSite({ initial = false, force = false } = {}) {
    const desired = S.materializeAnswers(state.records);
    const currently = siteAnswers();
    if (S.canonical(currently) === S.canonical(desired)) {
      snapshotPending = false;
      return false;
    }
    if (practiceRoute() && !initial && !force) {
      // React holds an in-memory snapshot on the practice page. Do not silently
      // replace localStorage while the user is answering: that could lose work.
      snapshotPending = true;
      return false;
    }
    localStorage.setItem(S.SITE_KEY, JSON.stringify(desired));
    state.lastSite = desired;
    snapshotPending = false;
    return true;
  }

  async function observeSiteChanges() {
    if (!state) return;
    const now = siteAnswers();
    const delta = S.detectLocalChanges(state.lastSite, now, state.deviceId, Date.now());
    if (!Object.keys(delta).length) return;
    state.records = S.mergeRecords(state.records, delta);
    state.lastSite = now;
    // Do not merge a remote save over an active React practice session.
    const cloud = await absorbCloud();
    if (!practiceRoute()) applyCloudToSite();
    await pushCloud(cloud);
  }

  async function refresh({ force = false } = {}) {
    await observeSiteChanges();
    const cloud = await absorbCloud();
    const updated = applyCloudToSite({ force });
    await pushCloud(cloud);
    return { updated, pending: snapshotPending, lastError };
  }

  function makeReadingRecord(chapter) {
    const docHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    const max = Math.max(1, docHeight - window.innerHeight);
    const y = Math.max(0, Math.floor(window.scrollY));
    let section = null;
    const node = document.querySelector(`.page[data-deck="${chapter}"]`);
    if (node) {
      for (const h of node.querySelectorAll('h2[id],h3[id]')) {
        if (h.getBoundingClientRect().top < 180) section = h.id;
        else break;
      }
    }
    return { percent: Math.round(Math.min(y / max, 1) * 100), y, section, updated: Date.now(), d: state.deviceId };
  }
  async function saveReading(force = false) {
    const ch = currentChapter();
    if (!ch || !state) return;
    const now = Date.now();
    if (!force && now - readingLastSaved < 7000) return;
    // Avoid overwriting a saved bookmark merely by opening a chapter at the top.
    if (window.scrollY < 110 && (!force || (state.reading[ch]?.percent ?? 0) > 5)) return;
    const next = makeReadingRecord(ch);
    const old = state.reading[ch];
    if (!force && old?.d === state.deviceId && old.section === next.section &&
        Math.abs(old.percent - next.percent) < 2 && now - old.updated < 30000) return;
    state.reading[ch] = next;
    readingLastSaved = now;
    await pushCloud();
  }
  function scheduleReading() {
    if (!currentChapter() || !state) return;
    clearTimeout(readingTimer);
    readingTimer = setTimeout(() => serial(() => saveReading()), 2100);
  }
  function handleRouteChange() {
    const newChapter = currentChapter();
    if (lastChapter && lastChapter !== newChapter) {
      // Route changes cause the old page to be removed, so its position is already
      // tracked during scroll. Do not overwrite it with the new page's scrollY.
      clearTimeout(readingTimer);
    }
    lastChapter = newChapter;
    if (!practiceRoute()) serial(async () => {
      await observeSiteChanges();
      applyCloudToSite();
      await persist();
    });
  }

  async function init() {
    const saved = (await chrome.storage.local.get(S.DEVICE_STATE_KEY))[S.DEVICE_STATE_KEY];
    const current = siteAnswers();
    const previouslyTracked = !!(saved && typeof saved === 'object' && saved.lastSite);
    state = {
      deviceId: typeof saved?.deviceId === 'string' ? saved.deviceId : crypto.randomUUID(),
      records: S.sanitizeRecords(saved?.records),
      reading: S.cleanReading(saved?.reading),
      lastSite: previouslyTracked ? S.parseSiteAnswers(saved.lastSite) : current,
    };
    if (previouslyTracked) {
      state.records = S.mergeRecords(state.records,
        S.detectLocalChanges(state.lastSite, current, state.deviceId, Date.now()));
    } else {
      // Initial import: unknown-age site answers should not replace newer cloud answers.
      const seed = Object.fromEntries(Object.entries(current).map(([id, v]) =>
        [id, { v, t: 0, d: state.deviceId }]));
      state.records = S.mergeRecords(state.records, seed);
    }
    state.lastSite = current;
    const cloud = await absorbCloud();
    const changed = applyCloudToSite({ initial: true });
    await pushCloud(cloud);
    lastChapter = currentChapter();
    if (changed && practiceRoute()) {
      // On first hydration React might already have read its old answer map.
      // One reload makes the restored localStorage visible to React.
      location.reload();
      return;
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !Object.keys(changes).some(k => k === S.READING_KEY || k.startsWith(S.ANSWER_PREFIX))) return;
      serial(async () => {
        await observeSiteChanges();
        const cloud = await absorbCloud();
        applyCloudToSite();
        await pushCloud(cloud);
      });
    });
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'SYNC_NOW') {
        serial(() => refresh()).then(() => sendResponse({ ok: true, pending: snapshotPending, error: lastError }));
        return true;
      }
      if (message?.type === 'GET_STATUS') {
        sendResponse({ ok: true, pending: snapshotPending, chapter: currentChapter(), error: lastError });
      }
      return false;
    });
    setInterval(() => serial(observeSiteChanges), 1800);
    addEventListener('scroll', scheduleReading, { passive: true });
    addEventListener('hashchange', handleRouteChange);
    addEventListener('pagehide', () => {
      if (currentChapter() && window.scrollY > 110) {
        // browser may discard async work during unload; ordinary scroll updates
        // are the primary persistence mechanism.
        serial(() => saveReading(true));
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') serial(() => saveReading(true));
      else serial(observeSiteChanges);
    });
  }
  await serial(init);
})();
