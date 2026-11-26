/* HFUT-CS-Online Sync: per-course quiz answers and per-route reading bookmarks.
   Isolated content script. It never changes the host website's source code. */
(async function () {
  'use strict';
  const S = globalThis.HFUTSiteSync;
  if (!S || !chrome?.storage?.sync) return;
  let state = null;
  let queue = Promise.resolve();
  let pending = false;
  let lastError = '';
  let readingTimer = null;
  let lastReadingAt = 0;
  let previousRoute = null;
  let lastRemoteAttempt = 0;
  let remoteError = '';
  let remoteSynced = false, initialized = false, invalidated = false, browserCloud = {};
  const intervals = [];
  function stopIfInvalid(err) {
    if(!/extension context invalidated/i.test(String(err?.message||err)))return false;
    if(!invalidated)console.warn('[HFUT Site Sync] 扩展已更新或失效，请刷新网页后重新连接。');
    invalidated=true;
    clearTimeout(readingTimer);
    for(const id of intervals)if(typeof clearInterval==='function')clearInterval(id);
    return true;
  }
  async function getCloud(strict=false) {
    try { browserCloud=await chrome.storage.sync.get(null); return browserCloud; }
    catch(err) { if(stopIfInvalid(err)||strict)throw err; return browserCloud; }
  }
  const SITE_NAME = 'HFUT-CS-Online';
  let lastInteraction=Date.now();
  const dayKey=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
  function reportActivity(active=false,questions=[]){
    if(invalidated||!state || (!active&&!questions.length))return;
    chrome.runtime.sendMessage({type:'STUDY_ACTIVITY',day:dayKey(),
      device:state.deviceId,active,questions}).catch(stopIfInvalid);
  }
  for(const event of ['pointerdown','keydown','scroll','touchstart']){
    addEventListener(event,()=>{lastInteraction=Date.now();},{passive:true});
  }
  // Time accrues only while the learning tab is visible, focused and recently used.
  intervals.push(setInterval(()=>{
    if(!invalidated&&state && document.visibilityState==='visible' && document.hasFocus() &&
       Date.now()-lastInteraction<=60000)reportActivity(true);
  },15000));

  function serial(job) {
    if(invalidated)return Promise.resolve();
    queue = queue.catch(() => {}).then(()=>invalidated?undefined:job()).catch(async err => {
      if(stopIfInvalid(err))return;
      lastError = String(err?.message || err);
      console.warn('[HFUT Site Sync]', lastError);
      try { await chrome.storage.local.set({ [S.LAST_ERROR]: lastError }); } catch {}
    });
    return queue;
  }
  function siteSnapshot() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i), course = S.courseOfKey(key);
        const metaCourse = key?.startsWith('hb-progress-meta:') ? S.courseOfKey(key.slice('hb-progress-meta:'.length)) : null;
        if (course) out[course] = S.sanitizeAnswers(localStorage.getItem(key));
        else if(metaCourse && !Object.hasOwn(out,metaCourse))out[metaCourse]=S.sanitizeAnswers(localStorage.getItem(S.keyOfCourse(metaCourse)));
      }
    } catch (err) { console.warn('[HFUT Site Sync] 读取网站记录失败', err); }
    return out;
  }
  function currentPracticeCourse() {
    const m = /^#\/([a-z][a-z0-9-]{1,17})\/practice(?:\/|\?|$)/.exec(location.hash);
    return m?.[1] || (/^#\/practice(?:\/|\?|$)/.test(location.hash) ? 'algo' : null);
  }
  function currentRoute() {
    if(/^#\/net\/deck\/[^?]+\?/.test(location.hash)&&new URLSearchParams(location.hash.split('?')[1]).get('view')==='extra')return null;
    return S.routeFromHash(location.hash);
  }
  function siteReading() {
    const records=S.fromNativeReading(localStorage.getItem(S.NATIVE_READING_KEY),state.deviceId,state.reading);
    for(const route of Object.keys(records))if(state.disabled[S.courseOfRoute(route)])delete records[route];
    state.reading=S.mergeReading(state.reading,records);
  }
  function notifySite(key,oldValue,newValue) {
    if(typeof StorageEvent==='function'&&typeof window.dispatchEvent==='function')
      window.dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue,storageArea:localStorage}));
  }
  function applyNativeReading() {
    const raw=localStorage.getItem(S.NATIVE_READING_KEY);
    const next=S.toNativeReading(raw,state.reading,state.disabled);
    if(S.stable(S.parseRecord(raw))===S.stable(next))return;
    const value=JSON.stringify(next);
    localStorage.setItem(S.NATIVE_READING_KEY,value);
    notifySite(S.NATIVE_READING_KEY,raw,value);
  }
  function importNativeProgress(snapshot) {
    for(const [course,answers] of Object.entries(snapshot)) {
      if(state.disabled[course])continue;
      const stamps=S.nativeProgress(localStorage.getItem(S.progressMetaKey(S.keyOfCourse(course))),answers,state.deviceId);
      // Same value/time from another device must not acquire a new device ID on every poll.
      for(const [id,stamp] of Object.entries(stamps)) {
        const old=state.records[course]?.[id];
        if(old&&old.t===stamp.t&&old.v===stamp.v)delete stamps[id];
      }
      state.records[course]=S.mergeRecords(state.records[course],stamps);
    }
  }
  function currentReading() {
    const route = currentRoute();
    return route ? state?.reading?.[route] : undefined;
  }
  async function saveLocal() {
    if (!state) return;
    await chrome.storage.local.set({ [S.STATE_KEY]: state });
  }
  function absorb(cloud) {
    const oldDisabled = state.disabled || {};
    state.disabled = S.disabledCourses(cloud);
    // The optional Question-Bank backend can disable a course even when the
    // current Android browser does not sync extension settings.
    for(const [course,control] of Object.entries(state.remoteControls||{})){
      if(control?.disabled === true) state.disabled[course]=true;
    }
    // Re-enabled courses import the site's existing answers on the next observation.
    for (const course of Object.keys(oldDisabled)) {
      if (!state.disabled[course]) delete state.lastSite[course];
    }
    state.records = S.mergeAll(state.records, S.cloudQuiz(cloud));
    state.reading = S.mergeReading(state.reading, S.cloudReading(cloud));
    // Never retain a disabled course in the extension cache or publish it again.
    for (const course of Object.keys(state.disabled)) {
      delete state.records[course];
      delete state.lastSite[course];
      for (const route of Object.keys(state.reading)) {
        if (S.courseOfRoute(route) === course) delete state.reading[route];
      }
    }
  }
  async function publish() {
    // Always re-read course controls just before saving, even if the caller has
    // an older snapshot. This prevents most in-flight writes after a disable.
    await saveLocal(); // persist before accessing optional browser sync
    const cloud = await getCloud(true);
    absorb(cloud);
    await saveLocal(); // local backup must survive even when cloud quota/rate limits fail
    const writes = {};
    for (const [course, rows] of Object.entries(state.records)) {
      if (state.disabled[course]) continue;
      const shards = S.shardCourse(rows);
      for (const [part, entries] of Object.entries(shards)) {
        const key = S.quizKey(course, Number(part));
        const existing = S.sanitizeRecords(cloud[key]?.entries);
        if (S.stable(existing) === S.stable(entries)) continue;
        const value = { version: 2, entries };
        if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 7500) {
          throw new Error('课程 ' + course + ' 有较多答题记录，超过浏览器单项同步限制。请导出备份。');
        }
        writes[key] = value;
      }
    }
    for (const [course, entries] of Object.entries(S.groupedReading(state.reading))) {
      if (state.disabled[course]) continue;
      const key = S.readKey(course);
      const existing = S.cleanReading(cloud[key]?.entries);
      if (S.stable(existing) === S.stable(entries)) continue;
      const value = { version: 2, entries };
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 7500) {
        throw new Error('课程 ' + course + ' 阅读记录超过浏览器单项同步限制。请导出备份。');
      }
      writes[key] = value;
    }
    if (Object.keys(writes).length) await chrome.storage.sync.set(writes);
    lastError = '';
    await chrome.storage.local.set({ [S.LAST_SUCCESS]: Date.now(), [S.LAST_ERROR]: '' });
  }
  function writeCloudToSite(options = {}) {
    const activePractice = currentPracticeCourse();
    const initial = options.initial === true;
    let touchedActive = false, wrote = false;
    for (const [course, records] of Object.entries(state.records)) {
      if (state.disabled[course]) continue;
      const desired = S.actualAnswers(records);
      const key = S.keyOfCourse(course);
      const raw=localStorage.getItem(key), all=S.parseRecord(raw);
      const current = S.sanitizeAnswers(all);
      if (S.stable(current) !== S.stable(desired) && !initial && course === activePractice) {
        touchedActive = true;
        continue;
      }
      const metaKey=S.progressMetaKey(key), metaRaw=localStorage.getItem(metaKey), meta=S.parseRecord(metaRaw);
      for(const [id,r] of Object.entries(records)) {
        // Do not erase an answer type the extension does not understand.
        if(Object.hasOwn(all,id)&&!Object.hasOwn(current,id))continue;
        if(r.v===null)delete all[id]; else all[id]=r.v;
        meta[id]={t:r.t,r:r.v};
      }
      if(S.stable(S.parseRecord(metaRaw))!==S.stable(meta))
        localStorage.setItem(metaKey,JSON.stringify(meta));
      if(S.stable(current)!==S.stable(desired)) {
        const value=JSON.stringify(all);
        localStorage.setItem(key,value);
        notifySite(key,raw,value);
        wrote=true;
        if(course===activePractice)touchedActive=true;
      }
      state.lastSite[course] = S.sanitizeAnswers(all);
    }
    applyNativeReading();
    pending = !initial && touchedActive;
    return { wrote, changedActive: initial && touchedActive };
  }
  function collectChanges(snapshot, countToday=true) {
    const newlyAnswered=[];
    for (const [course, answers] of Object.entries(snapshot)) {
      if (state.disabled[course]) continue;
      const baseline = state.lastSite[course] || {};
      const delta = S.changes(baseline, answers, state.deviceId, countToday?Date.now():0);
      const native=S.nativeProgress(localStorage.getItem(S.progressMetaKey(S.keyOfCourse(course))),answers,state.deviceId);
      for(const id of Object.keys(delta))if(native[id])delta[id]=native[id];
      if (Object.keys(delta).length) {
        for(const [id,item] of Object.entries(delta)){
          if(item.v!==null) newlyAnswered.push(course+':'+id);
        }
        state.records[course] = S.mergeRecords(state.records[course], delta);
        state.lastSite[course] = answers;
      }
    }
    if(countToday&&newlyAnswered.length)reportActivity(false,newlyAnswered);
  }
  async function observe(skipRemote=false) {
    if (!state) return;
    const cloud = await getCloud();
    absorb(cloud); // controls first, before reading this device's site records
    const snapshot=siteSnapshot();
    importNativeProgress(snapshot);
    collectChanges(snapshot);
    siteReading();
    writeCloudToSite();
    // Independent cloud sync must still run when the browser sync quota is full.
    let browserError;
    try{await publish();}catch(err){browserError=err;}
    if(!skipRemote)await remoteSync(); // remote automatic API requests are rate-limited
    if(browserError)throw browserError;
  }
  function remoteControlsForRequest(cloud) {
    const controls={...(state.remoteControls||{})};
    for(const [course,disabled] of Object.entries(S.disabledCourses(cloud))){
      if(disabled){
        const marker=cloud[S.disabledKey(course)];
        const next={disabled:true,t:marker?.updated||0,d:state.deviceId};
        const prev=controls[course];
        if(!prev||next.t>prev.t||(next.t===prev.t&&next.d>prev.d)) controls[course]=next;
      }
    }
    return controls;
  }
  async function remoteSync(force=false){
    const now=Date.now();
    if(!force && document.visibilityState==='hidden')return; // no background-tab polling
    if(!force&&now-lastRemoteAttempt<5*60*1000)return;
    lastRemoteAttempt=now;
    try {
      const cloud=await getCloud();
      const result=await chrome.runtime.sendMessage({
        type:'REMOTE_EXCHANGE',manual:force,records:state.records,reading:state.reading,
        controls:remoteControlsForRequest(cloud)
      });
      if(!result?.ok)throw new Error(result?.error||'远程服务错误');
      if(!result.enabled){if(force)remoteError='尚未登录独立云账号';return;} // Account cloud sync is opt-in.
      if(result.skipped)return; // another tab already contacted the API recently
      state.remoteControls=result.controls||{};
      state.records=S.mergeAll(state.records,result.records||{});
      state.reading=S.mergeReading(state.reading,result.reading||{});
      absorb(cloud); // Remote disable flags must be applied before any site writes.
      const snapshot=siteSnapshot();
      importNativeProgress(snapshot); collectChanges(snapshot); siteReading();
      writeCloudToSite();
      await saveLocal();
      try{await publish();}catch(err){
        console.warn('[HFUT Site Sync] Browser sync failed after independent cloud exchange:',err);
      }
      remoteError='';
      remoteSynced=true;
    } catch(err) {
      if(stopIfInvalid(err))return;
      remoteError=String(err?.message||err);
      console.warn('[HFUT Site Sync] Question-Bank 云同步：',remoteError);
    }
  }
  async function freshSync() {
    // Do not auto-exchange then immediately force another request on the same click.
    remoteSynced=false; remoteError='';
    try{await observe(true);}catch(err){if(stopIfInvalid(err))return;lastError=String(err?.message||err);}
    if(!invalidated)await remoteSync(true);
    return { pending, error:lastError, remoteError, remoteSynced };
  }

  function readingPosition(route) {
    const docHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    const maxY = Math.max(1, docHeight - window.innerHeight);
    const y = Math.max(0, Math.round(window.scrollY));
    let section = null;
    const scope = document.querySelector('.page') || document.querySelector('main') || document;
    for (const header of scope.querySelectorAll('h2[id],h3[id]')) {
      if (header.getBoundingClientRect().top < 180) section = header.id;
      else break;
    }
    let title = document.querySelector('.page h1')?.textContent?.trim() || document.title || SITE_NAME;
    if (title.length > 90) title = title.slice(0, 90);
    return { y, percent:Math.round(Math.min(1,y/maxY)*100), section, title, updated:Date.now(), d:state.deviceId };
  }
  async function recordReading(force = false) {
    const route = currentRoute();
    if (!state || !route || state.disabled[S.courseOfRoute(route)] || window.scrollY < 110) return;
    const now = Date.now();
    if(S.nativeRoute(route)&&localStorage.getItem(S.NATIVE_READING_KEY)!==null){
      // The upstream page writes after its own debounce; use its timestamp and precision.
      await observe(); return;
    }
    if (!force && now - lastReadingAt < 6500) return;
    const candidate = readingPosition(route);
    const prior = state.reading[route];
    if (!force && prior?.d === state.deviceId && prior.section === candidate.section &&
        Math.abs(prior.percent-candidate.percent) < 2 && now-prior.updated < 30000) return;
    state.reading[route] = candidate;
    lastReadingAt = now;
    let browserError;
    try{await publish();}catch(err){browserError=err;}
    await remoteSync(); // opportunistic upload, max one auto request per 5 minutes
    if(browserError)throw browserError;
  }
  function scheduleReading() {
    if (!currentRoute()) return;
    clearTimeout(readingTimer);
    if(invalidated)return;
    readingTimer = setTimeout(() => serial(() => recordReading()), 2200);
  }
  function resumeIfRequested() {
    if (!/[?&]hfut_sync_resume=1(?:&|$)/.test(location.hash)) return;
    const route = currentRoute();
    const rec = state?.reading?.[route];
    if (!rec) return;
    let userMoved = false;
    const mark = () => { userMoved = true; };
    for (const ev of ['wheel','touchstart','pointerdown','keydown']) addEventListener(ev,mark,{once:true});
    const restore = () => {
      if (userMoved || currentRoute() !== route) return;
      // Reposition after React's normal mount / scroll-to-top effects have finished.
      const max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
      window.scrollTo({top:max>=240?Math.round(max*rec.percent/100):rec.y,behavior:'instant'});
    };
    setTimeout(restore, 350);
    setTimeout(restore, 950);
  }
  function onRouteChange() {
    const route = currentRoute();
    if (route !== previousRoute) {
      clearTimeout(readingTimer);
      previousRoute = route;
    }
    serial(async () => {
      await observe();
      resumeIfRequested();
    });
  }
  async function init() {
    const stored = (await chrome.storage.local.get(S.STATE_KEY))[S.STATE_KEY];
    const snapshot = siteSnapshot();
    const hasBaseline = !!(stored && typeof stored === 'object' && stored.lastSite);
    state = {
      deviceId: typeof stored?.deviceId === 'string' && stored.deviceId.length < 90 ? stored.deviceId : crypto.randomUUID().slice(0,12),
      records: {},
      reading: S.cleanReading(stored?.reading),
      lastSite: hasBaseline && stored.lastSite && typeof stored.lastSite === 'object' ? stored.lastSite : {},
      disabled: {},
      remoteControls: stored?.remoteControls && typeof stored.remoteControls==='object'
        ?stored.remoteControls:{},
    };
    state.records = S.mergeAll({},stored?.records||{});
    if (hasBaseline) {
      collectChanges(snapshot,false); // historical changes have unknown dates
    } else {
      // Preserve pre-existing site answers as the oldest possible events.
      for (const [course, answers] of Object.entries(snapshot)) {
        state.records[course] = S.mergeRecords(state.records[course],
          Object.fromEntries(Object.entries(answers).map(([q,v]) => [q,{v,t:0,d:state.deviceId}])));
      }
      state.lastSite = snapshot;
    }
    const cloud = await getCloud();
    absorb(cloud);
    importNativeProgress(snapshot); siteReading();
    const applied = writeCloudToSite({initial:true});
    try{await publish();}catch(err){
      console.warn('[HFUT Site Sync] Browser sync unavailable:',err);
    }
    previousRoute = currentRoute();
    if (applied.changedActive) {
      // The React practice view may have read old results before asynchronous hydration.
      location.reload();
    }
    chrome.storage.onChanged.addListener((changes,area) => {
      if (area !== 'sync' || !Object.keys(changes).some(k =>
        k.startsWith(S.QUIZ_PREFIX) || k.startsWith(S.READ_PREFIX) ||
        k.startsWith(S.DISABLE_PREFIX))) return;
      serial(async () => {
        // Preserve overwritten records during concurrent normal updates, but do
        // NOT re-add the old value of a deliberately removed course storage key.
        const old = {};
        for (const [key,val] of Object.entries(changes)) {
          if (val.oldValue && val.newValue &&
              (key.startsWith(S.QUIZ_PREFIX) || key.startsWith(S.READ_PREFIX))) {
            old[key] = val.oldValue;
          }
        }
        const fresh = await getCloud();
        const disabled = S.disabledCourses(fresh);
        const earlierQuiz = S.cloudQuiz(old);
        for (const course of Object.keys(earlierQuiz)) if (disabled[course]) delete earlierQuiz[course];
        state.records = S.mergeAll(state.records, earlierQuiz);
        const earlierReading = S.cloudReading(old);
        for (const route of Object.keys(earlierReading)) {
          if (disabled[S.courseOfRoute(route)]) delete earlierReading[route];
        }
        state.reading = S.mergeReading(state.reading, earlierReading);
        await observe();
      });
    });
    intervals.push(setInterval(() => serial(observe), 3000));
    addEventListener('scroll',scheduleReading,{passive:true});
    addEventListener('hashchange',onRouteChange);
    addEventListener('pagehide',() => {
      if (window.scrollY >= 110) serial(()=>recordReading(true));
    });
    document.addEventListener('visibilitychange',() => {
      if (document.visibilityState === 'hidden') serial(()=>recordReading(true));
      else serial(observe);
    });
    initialized=true;
    await remoteSync(); // independent cloud can work even if browser storage is full
    resumeIfRequested();
  }
  // Register synchronously before storage reads or network calls, including cold startup.
  chrome.runtime.onMessage.addListener((m,_sender,respond) => {
    if(m?.type==='GET_STATUS'){respond({ok:true,ready:initialized,pending,error:lastError,route:currentRoute()});return false;}
    if(m?.type==='SYNC_NOW'||m?.type==='REMOTE_SIGNOUT'){
      serial(async()=>{
        if(!initialized)await init();
        if(m.type==='SYNC_NOW')await freshSync();
        else {
          state.remoteControls={};
          absorb(await getCloud());
          await saveLocal();
        }
      }).then(()=>respond({ok:initialized&&!invalidated,pending,error:lastError,remoteError,remoteSynced}));
      return true;
    }
    return false;
  });
  await serial(init);
})();
