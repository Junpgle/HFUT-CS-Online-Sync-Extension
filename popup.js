(async function () {
  'use strict';
  const S = globalThis.HFUTNetSync;
  const $ = (id) => document.getElementById(id);
  const names = { 'paper-2021': '2021—2022 学年', 'paper-2022': '2022—2023 学年', 'paper-2024': '2024—2025 学年' };
  const paperTotals = { 'paper-2021': 27, 'paper-2022': 45, 'paper-2024': 29 };
  const formatTime = (ms) => ms ? new Date(ms).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '尚未同步';
  const message = (str, err = false) => {
    $('status-msg').textContent = str;
    $('status-msg').classList.toggle('error', err);
  };
  async function activeSiteTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !(
      tab.url.startsWith(S.SITE_URL) || tab.url.startsWith('http://localhost:5173/HFUT-CS-Online/'))
    ) return null;
    return tab;
  }
  async function cloud() { return chrome.storage.sync.get(null); }
  async function render() {
    const [c, local] = await Promise.all([
      cloud(), chrome.storage.local.get([S.PREFIX + 'last_success', S.PREFIX + 'last_error']),
    ]);
    const records = S.cloudAnswers(c);
    const answers = S.materializeAnswers(records);
    const readings = S.cleanReading(c[S.READING_KEY]?.entries);
    const total = Object.keys(answers).length;
    $('quiz-count').textContent = String(total);
    $('right-count').textContent = String(Object.values(answers).filter(v=>v==='right').length);
    $('chapter-count').textContent = `${Object.keys(readings).length}/7`;
    $('sync-time').textContent = formatTime(local[S.PREFIX + 'last_success']);
    const error = local[S.PREFIX + 'last_error'];
    if (error) message('上次同步失败：' + error, true);
    const ordered = Object.entries(readings).sort((a,b)=>b[1].updated-a[1].updated);
    const el = $('readings');
    el.replaceChildren();
    if (!ordered.length) {
      const p=document.createElement('p');p.className='empty';p.textContent='浏览计网章节并滚动阅读后，这里会显示记录。';el.append(p);
    }
    for (const [ch, value] of ordered.slice(0, 7)) {
      const a=document.createElement('a');a.className='reading';
      a.href=S.readingUrl(ch,value);a.target='_blank';a.rel='noopener noreferrer';
      const head=document.createElement('div');head.className='reading-top';
      const title=document.createElement('span');title.className='reading-name';title.textContent=`第 ${ch.slice(2)} 章 · ${S.CHAPTERS[Number(ch.slice(2))-1]}`;
      const pct=document.createElement('span');pct.className='reading-pct';pct.textContent=`${value.percent}%`;
      head.append(title,pct);
      const track=document.createElement('div');track.className='track';const fill=document.createElement('span');fill.style.width=`${value.percent}%`;track.append(fill);
      a.append(head,track);el.append(a);
    }
    const p=$('papers');p.replaceChildren();
    for (const [paper, title] of Object.entries(names)) {
      const a=document.createElement('div');a.className='paper';
      const text=document.createElement('span');text.textContent=title;
      const right=document.createElement('strong');right.textContent=`${Object.keys(answers).filter(q=>S.paperOf(q)===paper).length} / ${paperTotals[paper]} 题`;
      a.append(text,right);p.append(a);
    }
  }
  $('sync').addEventListener('click', async () => {
    $('sync').disabled=true;
    try {
      const tab=await activeSiteTab();
      if (!tab) { message('请先打开计网网站，再点击“立即同步”；现有云端记录仍可查看。'); return; }
      const result=await chrome.tabs.sendMessage(tab.id,{type:'SYNC_NOW'});
      await render();
      if (result?.pending) message('已合并云端记录，当前做题页需点击“刷新网站”显示新结果。');
      else if (result?.error) message(result.error,true);
      else message('已完成本机与浏览器同步存储的读写；其他设备可能稍后收到。');
    } catch(e) { message('无法联系网站页面。请重新打开或刷新网站后重试。',true); }
    finally { $('sync').disabled=false; }
  });
  $('reload').addEventListener('click', async () => {
    const tab=await activeSiteTab();
    if (!tab) { message('请先打开计网网站再刷新。'); return; }
    try { await chrome.tabs.reload(tab.id); message('网页已刷新，扩展会在加载时应用云端记录。'); }
    catch { message('刷新失败，请手动刷新网页。',true); }
  });
  $('visit').addEventListener('click',()=>chrome.tabs.create({url:S.SITE_URL+'#/net'}));
  $('export').addEventListener('click', async()=>{
    try {
      const c=await cloud();
      const backup={format:'HFUT-Net-Sync',version:1,exportedAt:new Date().toISOString(),answers:S.cloudAnswers(c),reading:S.cleanReading(c[S.READING_KEY]?.entries)};
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download='hfut-net-learning-backup.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      message('备份文件已导出，可在另一浏览器里导入。');
    } catch (e) { message('备份导出失败：'+e.message,true); }
  });
  $('import').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change', async(event)=>{
    const file=event.target.files?.[0];if(!file) return;
    try {
      if (file.size>300000) throw new Error('备份文件过大');
      const backup=JSON.parse(await file.text());
      if(backup.format!=='HFUT-Net-Sync'||backup.version!==1) throw new Error('不是兼容的同步备份文件');
      const c=await cloud();
      const records=S.mergeRecords(S.cloudAnswers(c),backup.answers);
      const reading=S.mergeReading(c[S.READING_KEY]?.entries,backup.reading);
      const paperMap=S.splitPapers(records);
      const updates=Object.fromEntries(Object.entries(paperMap).map(([k,v])=>[S.ANSWER_PREFIX+k,{version:1,entries:v}]));
      updates[S.READING_KEY]={version:1,entries:reading};
      for(const [key,item] of Object.entries(updates)) {
        if(new TextEncoder().encode(JSON.stringify(item)).length>7500) throw new Error(`${key} 超出浏览器同步存储单项限制`);
      }
      await chrome.storage.sync.set(updates);
      await render();
      message('备份已合并。打开或刷新计网网站，即可恢复做题和阅读记录。');
    } catch(e) { message('导入失败：'+e.message,true); }
    finally { event.target.value=''; }
  });
  await render();
  // Show progress received from another signed-in browser while popup is open.
  chrome.storage.onChanged.addListener((_changes,area)=>{if(area==='sync') render().catch(()=>{});});
})();
