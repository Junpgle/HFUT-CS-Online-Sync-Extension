/* Shared, dependency-free helpers used by the content script and popup. */
(function (root) {
  'use strict';
  const PREFIX = 'hfutnet_v1_';
  const ANSWER_PREFIX = PREFIX + 'answers_';
  const READING_KEY = PREFIX + 'reading';
  const DEVICE_STATE_KEY = PREFIX + 'device_state';
  const SITE_KEY = 'net-practice-progress-v1';
  const SITE_URL = 'https://saltgardenia.github.io/HFUT-CS-Online/';
  const VALID = new Set(['right', 'wrong', 'revealed']);
  const MAX_ANSWERS = 1200;
  const CHAPTERS = ['概论', '计算机网络体系结构', '物理层', '数据链路层', '网络层', '传输层', '应用层'];

  function isPlainObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function paperOf(qid) {
    return typeof qid === 'string' && /^paper-\d{4}:[a-zA-Z0-9_-]{1,40}$/.test(qid)
      ? qid.split(':')[0] : null;
  }
  function parseSiteAnswers(raw) {
    let parsed;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
    if (!isPlainObject(parsed)) return {};
    const cleaned = {};
    for (const [id, value] of Object.entries(parsed).slice(0, MAX_ANSWERS)) {
      if (paperOf(id) && VALID.has(value)) cleaned[id] = value;
    }
    return cleaned;
  }
  function normalizedRecord(x) {
    if (!isPlainObject(x)) return null;
    if (!(x.v === null || VALID.has(x.v))) return null;
    if (!Number.isFinite(x.t) || x.t < 0 || x.t > 9e15) return null;
    if (typeof x.d !== 'string' || x.d.length > 96) return null;
    return { v: x.v, t: x.t, d: x.d };
  }
  function sanitizeRecords(raw) {
    if (!isPlainObject(raw)) return {};
    const result = {};
    for (const [id, record] of Object.entries(raw).slice(0, MAX_ANSWERS)) {
      if (!paperOf(id)) continue;
      const good = normalizedRecord(record);
      if (good) result[id] = good;
    }
    return result;
  }
  function compareRecord(a, b) {
    if (!a) return -1;
    if (!b) return 1;
    return a.t !== b.t ? Math.sign(a.t - b.t) :
      a.d !== b.d ? (a.d < b.d ? -1 : 1) :
      String(a.v).localeCompare(String(b.v));
  }
  function mergeRecords(a, b) {
    const result = { ...sanitizeRecords(a) };
    for (const [key, value] of Object.entries(sanitizeRecords(b))) {
      if (compareRecord(result[key], value) < 0) result[key] = value;
    }
    return result;
  }
  function detectLocalChanges(previous, current, device, time) {
    const result = {};
    const keys = new Set([...Object.keys(previous || {}), ...Object.keys(current || {})]);
    let offset = 0;
    for (const key of keys) {
      if (!paperOf(key) || previous?.[key] === current?.[key]) continue;
      result[key] = { v: current?.[key] ?? null, t: time + offset++, d: device };
    }
    return result;
  }
  function materializeAnswers(records) {
    const result = {};
    for (const [key, record] of Object.entries(sanitizeRecords(records))) {
      if (record.v !== null) result[key] = record.v;
    }
    return result;
  }
  function canonical(obj) {
    return JSON.stringify(Object.fromEntries(Object.entries(obj || {}).sort(([a], [b]) => a.localeCompare(b))));
  }
  function splitPapers(records) {
    const grouped = {};
    for (const [id, value] of Object.entries(sanitizeRecords(records))) {
      const paper = paperOf(id);
      (grouped[paper] ??= {})[id] = value;
    }
    for (const p of Object.keys(grouped)) grouped[p] = Object.fromEntries(Object.entries(grouped[p]).sort());
    return grouped;
  }
  function cloudAnswers(map) {
    let records = {};
    for (const [key, val] of Object.entries(map || {})) {
      if (!key.startsWith(ANSWER_PREFIX)) continue;
      if (!/^paper-\d{4}$/.test(key.slice(ANSWER_PREFIX.length))) continue;
      records = mergeRecords(records, val?.entries || {});
    }
    return records;
  }
  function cleanReading(raw) {
    const out = {};
    if (!isPlainObject(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
      if (!/^ch[1-7]$/.test(k) || !isPlainObject(v) || !Number.isFinite(v.updated)) continue;
      out[k] = {
        percent: Math.max(0, Math.min(100, Number(v.percent) || 0)),
        y: Math.max(0, Math.min(2000000, Number(v.y) || 0)),
        section: typeof v.section === 'string' && /^[A-Za-z0-9_-]{1,90}$/.test(v.section) ? v.section : null,
        updated: Math.max(0, v.updated),
        d: typeof v.d === 'string' ? v.d.slice(0, 96) : '',
      };
    }
    return out;
  }
  function mergeReading(a, b) {
    const result = cleanReading(a);
    for (const [chapter, other] of Object.entries(cleanReading(b))) {
      const own = result[chapter];
      if (!own || other.updated > own.updated || (other.updated === own.updated && other.d > own.d)) {
        result[chapter] = other;
      }
    }
    return result;
  }
  function readingUrl(chapter, record) {
    const hash = `#/net/deck/${chapter}`;
    return SITE_URL + hash + (record?.section ? `?s=${encodeURIComponent(record.section)}` : '');
  }
  root.HFUTNetSync = Object.freeze({
    PREFIX, ANSWER_PREFIX, READING_KEY, DEVICE_STATE_KEY, SITE_KEY, SITE_URL, CHAPTERS,
    paperOf, parseSiteAnswers, sanitizeRecords, mergeRecords, compareRecord,
    detectLocalChanges, materializeAnswers, canonical, splitPapers,
    cloudAnswers, cleanReading, mergeReading, readingUrl,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
