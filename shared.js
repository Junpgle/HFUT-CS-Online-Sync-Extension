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
    pd:'程序设计基础', sa:'软件体系结构', hd:'系统硬件综合设计',
    ...{"algo":"算法设计与分析","os":"操作系统","net":"计算机网络","pat":"程序设计艺术与方法","ai":"人工智能原理","sa":"软件体系结构","phys":"大学物理","ca":"计算机体系结构","math":"高等数学","pd":"程序设计基础","ncd":"计算机网络课程设计","nap":"网络攻防实践","hd":"系统硬件综合设计","mc":"移动计算与应用开发","nlu":"自然语言理解","oscd":"操作系统课程设计","cpd":"编译原理课程设计","ntr":"网络工程师综合实训","cv":"计算机视觉与深度学习","spm":"软件项目管理","bd":"大数据处理技术","cap":"计算机应用项目实训","aie":"人工智能经济学","sec":"信息安全技术","db":"数据库系统","se":"软件工程","st":"软件测试","dp":"分布式程序设计","swt":"软件工程师综合训练","dsd":"领域方向综合设计","ip":"创新实践","py":"Python程序设计","dm":"离散数学","cm":"计算方法","prob":"概率论与数理统计","asm":"汇编语言程序设计","eda":"EDA实训","res":"科研训练","physlab":"大学物理实验","java":"Java技术","dl":"数字逻辑","robot":"机器人技术","ds":"数据结构","dscd":"数据结构课程设计","la":"线性代数","ee":"电路与电子技术基础","comp":"编译原理","co":"计算机组成原理","emb":"嵌入式系统原理","ml":"机器学习","ste":"软件工具与环境","comb":"组合数学","cg":"计算机图形学","sma":"软件建模与分析","dmt":"数字媒体技术","np":"网络程序设计","micro":"微机原理与接口技术","het":"硬件工程师综合训练"}
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
  const NATIVE_READING_KEY = 'hb-reading-v1';
  const progressMetaKey = key => 'hb-progress-meta:' + key;
  function parseRecord(raw) {
    try { const value = typeof raw === 'string' ? JSON.parse(raw) : raw; return object(value) ? value : {}; }
    catch { return {}; }
  }
  function nativeRoute(route) {
    return typeof route === 'string' && /^#\/[a-z][a-z0-9-]*\/(?:deck|chapter)\/[^/]+$/.test(route)
      && courseOfRoute(route) ? route.slice(1) : null;
  }
  function fromNativeReading(raw, device, previous={}) {
    const out={};
    for (const [page,e] of Object.entries(parseRecord(raw))) {
      const route='#'+page, c=courseOfRoute(route);
      if (!nativeRoute(route)||!object(e)||e.c!==c||!Number.isSafeInteger(e.t)||e.t<0||e.t>9e15||
          !Number.isFinite(e.y)||e.y<0||!Number.isFinite(e.p)||e.p<0||e.p>1) continue;
      const old=previous[route];
      // Preserve the old wire record on an exact round trip (including device ID).
      if(old&&old.updated===e.t&&old.y===e.y&&Math.abs(old.percent-e.p*100)<1e-8) {
        out[route]=old; continue;
      }
      out[route]={percent:e.p*100,y:e.y,section:null,
        title:typeof e.s==='string'&&e.s.trim()?e.s.slice(0,90):(old?.title||page),
        updated:e.t,d:device};
    }
    return cleanReading(out);
  }
  function toNativeReading(raw, reading, disabled={}) {
    const out={...parseRecord(raw)};
    for(const [route,e] of Object.entries(cleanReading(reading))) {
      const page=nativeRoute(route), c=courseOfRoute(route);
      if(!page||disabled[c])continue;
      const old=out[page];
      if(object(old)&&Number.isFinite(old.t)&&old.t>=e.updated)continue;
      out[page]={c,y:e.y,p:e.percent/100,t:e.updated};
      // Native section text and the legacy DOM section ID are different fields.
      // Preserve the original native text when available, do not treat an ID as text.
      if(e.title && e.title!==page && !e.section)out[page].s=e.title.slice(0,60);
    }
    return out;
  }
  function nativeProgress(raw, answers, device) {
    const out={};
    for(const [id,m] of Object.entries(parseRecord(raw))) {
      if(!questionValid(id)||!object(m)||!Number.isSafeInteger(m.t)||m.t<0||m.t>9e15)continue;
      if(m.r===null ? !Object.hasOwn(answers,id) : VALID.has(m.r)&&answers[id]===m.r)
        out[id]={v:m.r,t:m.t,d:device};
    }
    return out;
  }
  function cleanReading(raw) {
    const out={};
    if(!object(raw))return out;
    for(const [route,r] of Object.entries(raw).sort((a,b)=>(Number(b[1]?.updated)||0)-(Number(a[1]?.updated)||0)).slice(0,500)) {
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
    cloudReading,groupedReading,disabledKey,courseOfDisableKey,disabledCourses,courseCloudKeys,resumeUrl,
    NATIVE_READING_KEY,progressMetaKey,parseRecord,nativeRoute,fromNativeReading,toNativeReading,nativeProgress
  });
})(typeof globalThis!=='undefined'?globalThis:this);
