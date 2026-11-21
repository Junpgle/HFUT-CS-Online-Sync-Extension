/* Data contract for HFUT-CS-Online Sync (MV3); intentionally no network access. */
(function (root) {
  'use strict';
  const PREFIX = 'hfutsite_v2_';
  const STATE_KEY = PREFIX + 'local_state';
  const LAST_SUCCESS = PREFIX + 'last_success';
  const LAST_ERROR = PREFIX + 'last_error';
  const QUIZ_PREFIX = PREFIX + 'q_';
  const READ_PREFIX = PREFIX + 'read_';
  const DISABLE_PREFIX = PREFIX + 'disabled_';
  const SITE_URL = 'https://saltgardenia.github.io/HFUT-CS-Online/';
  const VALID = new Set(['right', 'wrong', 'revealed']);
  const MAX_Q = 5000, SHARDS = 16, MAX_READ = 40;
  const TITLES = {
    algo:'算法设计与分析', os:'操作系统', net:'计算机网络', math:'高等数学',
    ca:'计算机体系结构', db:'数据库系统', se:'软件工程', st:'软件测试',
    phys:'大学物理', pat:'程序设计艺术与方法', ai:'人工智能原理',
    pd:'程序设计基础', sa:'软件体系结构', hd:'系统硬件综合设计'
  };
  const object = x => x != null && typeof x === 'object' && !Array.isArray(x);
  const courseValid = x => typeof x === 'string' && /^[a-z][a-z0-9-]{1,17}$/.test(x);
  function courseOfKey(key) {
    if (key === 'practice-progress-v1') return 'algo';
    const m = /^([a-z][a-z0-9-]{1,17})-practice-progress-v1$/.exec(key || '');
    return m ? m[1] : null;
  }
  function keyOfCourse(c) { return c === 'algo' ? 'practice-progress-v1' : c + '-practice-progress-v1'; }
  function questionValid(id) { return typeof id === 'string' && /^[A-Za-z0-9:_-]{1,130}$/.test(id); }
  function sanitizeAnswers(raw) {
    let parsed = raw;
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return {}; } }
    if (!object(parsed)) return {};
    const out = {};
    for (const [id, v] of Object.entries(parsed).slice(0, MAX_Q)) {
      if (questionValid(id) && VALID.has(v)) out[id] = v;
    }
    return out;
  }
  function cleanRecord(r) {
    if (!object(r) || !(r.v === null || VALID.has(r.v)) ||
      !Number.isFinite(r.t) || r.t < 0 || r.t > 9e15 || typeof r.d !== 'string' || r.d.length > 90) return null;
    return { v:r.v, t:r.t, d:r.d };
  }
  function sanitizeRecords(raw) {
    if (!object(raw)) return {};
    const out = {};
    for (const [k,v] of Object.entries(raw).slice(0,MAX_Q)) {
      const r = questionValid(k) ? cleanRecord(v) : null;
      if (r) out[k] = r;
    }
    return out;
  }
  function compareRecord(a,b) {
    if (!a) return -1;
    if (!b) return 1;
    if (a.t !== b.t) return Math.sign(a.t-b.t);
    if (a.d !== b.d) return a.d < b.d ? -1 : 1;
    return String(a.v).localeCompare(String(b.v));
  }
  function mergeRecords(a,b) {
    const out = sanitizeRecords(a);
    for (const [k,v] of Object.entries(sanitizeRecords(b))) {
      if (compareRecord(out[k],v)<0) out[k]=v;
    }
    return out;
  }
  function mergeAll(a,b) {
    const out = {};
    for (const c of new Set([...Object.keys(a||{}),...Object.keys(b||{})])) {
      if (courseValid(c)) out[c] = mergeRecords(a?.[c],b?.[c]);
    }
    return out;
  }
  function changes(oldAnswers,newAnswers,device,t) {
    const old = sanitizeAnswers(oldAnswers), cur = sanitizeAnswers(newAnswers);
    const out = {}; let i=0;
    for (const q of new Set([...Object.keys(old),...Object.keys(cur)])) {
      if (old[q]!==cur[q]) out[q]={v:cur[q]??null,t:t+(i++),d:device};
    }
    return out;
  }
  function actualAnswers(records) {
    const out={};
    for(const [q,r] of Object.entries(sanitizeRecords(records))) if(r.v!==null)out[q]=r.v;
    return out;
  }
  function stable(o) {
    return JSON.stringify(Object.fromEntries(Object.entries(o||{}).sort(([a],[b])=>a.localeCompare(b))));
  }
  function hash(str) {
    let h=2166136261;
    for(let i=0;i<str.length;i++) { h^=str.charCodeAt(i);h=Math.imul(h,16777619); }
    return h>>>0;
  }
  function quizKey(course,part) { return QUIZ_PREFIX + course + '_' + part.toString(16); }
  function readKey(course) { return READ_PREFIX + course; }
  function courseOfCloudQuizKey(key) {
    const m = new RegExp('^' + QUIZ_PREFIX + '([a-z][a-z0-9-]{1,17})_([0-9a-f])$').exec(key||'');
    return m ? m[1] : null;
  }
  function shardCourse(records) {
    const out={};
    for(const [qid,r] of Object.entries(sanitizeRecords(records))) {
      const h=hash(qid)%SHARDS;
      (out[h]??={})[qid]=r;
    }
    return out;
  }
  function cloudQuiz(all) {
    const out={};
    for(const [key,v] of Object.entries(all||{})) {
      const c=courseOfCloudQuizKey(key);
      if (!c) continue;
      const bucket=Number.parseInt(key.slice(-1),16);
      const valid=Object.fromEntries(Object.entries(sanitizeRecords(v?.entries)).filter(([q])=>hash(q)%SHARDS===bucket));
      out[c]=mergeRecords(out[c],valid);
    }
    return out;
  }
  function courseOfRoute(route) {
    if(typeof route !== 'string' || route.length>200 || !/^#\/[a-z][a-z0-9/-]*$/.test(route)) return null;
    const c=route.split('/')[1];
    if(!courseValid(c) || ['course','preview','practice'].includes(c)) return null;
    if(route.split('/').some(p=>p==='practice'||p==='attachments')) return null;
    return c;
  }
  function routeFromHash(hash) {
    const route=(hash||'').split('?')[0];
    return courseOfRoute(route) ? route : null;
  }
  function cleanReading(raw) {
    const out={};
    if(!object(raw))return out;
    for(const [route,r] of Object.entries(raw).slice(0,MAX_READ*4)) {
      if(!courseOfRoute(route)||!object(r)||!Number.isFinite(r.updated)||r.updated<0||r.updated>9e15)continue;
      out[route]={
        percent:Math.min(100,Math.max(0,Number(r.percent)||0)),
        y:Math.min(2e6,Math.max(0,Number(r.y)||0)),
        section:typeof r.section==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(r.section)?r.section:null,
        title:typeof r.title==='string'?r.title.slice(0,90):'',
        updated:r.updated,
        d:typeof r.d==='string'?r.d.slice(0,90):''
      };
    }
    return out;
  }
  function mergeReading(a,b) {
    const out=cleanReading(a);
    for(const [route,v] of Object.entries(cleanReading(b))) {
      const old=out[route];
      if(!old||v.updated>old.updated||(v.updated===old.updated&&v.d>old.d))out[route]=v;
    }
    const byCourse={};
    for(const [route,v] of Object.entries(out)) {
      const c=courseOfRoute(route);
      (byCourse[c]??=[]).push([route,v]);
    }
    const limited={};
    for(const rows of Object.values(byCourse)) {
      rows.sort((a,b)=>b[1].updated-a[1].updated);
      for(const [route,r] of rows.slice(0,MAX_READ))limited[route]=r;
    }
    return limited;
  }
  function cloudReading(all) {
    let out={};
    for(const [key,v] of Object.entries(all||{})) {
      if(!key.startsWith(READ_PREFIX)||!courseValid(key.slice(READ_PREFIX.length)))continue;
      out=mergeReading(out,v?.entries);
    }
    return out;
  }
  function groupedReading(reading) {
    const groups={};
    for(const [route,r] of Object.entries(cleanReading(reading))) {
      const c=courseOfRoute(route);
      (groups[c]??={})[route]=r;
    }
    return groups;
  }
  function disabledKey(course) { return DISABLE_PREFIX + course; }
  function courseOfDisableKey(key) {
    if (typeof key !== 'string' || !key.startsWith(DISABLE_PREFIX)) return null;
    const course = key.slice(DISABLE_PREFIX.length);
    return courseValid(course) ? course : null;
  }
  function disabledCourses(cloud) {
    const out = {};
    for (const [key, value] of Object.entries(cloud || {})) {
      const course = courseOfDisableKey(key);
      if (course && value?.disabled === true) out[course] = true;
    }
    return out;
  }
  function courseCloudKeys(cloud, course) {
    if (!courseValid(course)) return [];
    return Object.keys(cloud || {}).filter(key =>
      courseOfCloudQuizKey(key) === course || key === readKey(course));
  }
  function resumeUrl(route) {
    if(!courseOfRoute(route))return SITE_URL+'#/'; 
    return SITE_URL+route+'?hfut_sync_resume=1';
  }
  root.HFUTSiteSync=Object.freeze({
    PREFIX,STATE_KEY,LAST_SUCCESS,LAST_ERROR,QUIZ_PREFIX,READ_PREFIX,DISABLE_PREFIX,SITE_URL,TITLES,
    courseOfKey,keyOfCourse,questionValid,sanitizeAnswers,sanitizeRecords,
    mergeRecords,mergeAll,changes,actualAnswers,stable,hash,quizKey,readKey,shardCourse,
    cloudQuiz,courseOfCloudQuizKey,courseOfRoute,routeFromHash,cleanReading,mergeReading,
    cloudReading,groupedReading,disabledKey,courseOfDisableKey,disabledCourses,courseCloudKeys,resumeUrl
  });
})(typeof globalThis!=='undefined'?globalThis:this);
