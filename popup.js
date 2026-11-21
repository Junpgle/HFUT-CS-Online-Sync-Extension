/* Popup dashboard for all courses. Uses only extension storage; no website changes. */
(async function () {
  'use strict';
  const S=globalThis.HFUTSiteSync;
  if(!S)return;
  const $=id=>document.getElementById(id);
  const text=(el,value)=>{el.textContent=String(value);};
  function status(str,isError=false) {
    text($('status-msg'),str);
    $('status-msg').classList.toggle('error',isError);
  }
  const when = ms => ms ? new Date(ms).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '尚未同步';
  function activeSiteTab() {
    return chrome.tabs.query({active:true,currentWindow:true}).then(([t])=>{
      const u=t?.url||'';
      return t?.id && (u.startsWith(S.SITE_URL)||
        u.startsWith('http://localhost:5173/HFUT-CS-Online/')) ? t : null;
    });
  }
  async function combined() {
    const [cloud,local]=await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get([S.STATE_KEY,S.LAST_SUCCESS,S.LAST_ERROR])
    ]);
    const device=local[S.STATE_KEY]||{};
    return {
      cloud,
      local,
      records:S.mergeAll(S.cloudQuiz(cloud),device.records||{}),
      reading:S.mergeReading(S.cloudReading(cloud),device.reading||{})
    };
  }
  function courseTitle(c) { return S.TITLES[c]||c.toUpperCase(); }
  async function render() {
    const data=await combined();
    let n=0,right=0;
    const courseStats={};
    for(const [course,records] of Object.entries(data.records)){
      const ans=S.actualAnswers(records);
      const values=Object.values(ans);
      const count=values.length;
      n+=count;right+=values.filter(v=>v==='right').length;
      if(count)courseStats[course]={count,right:values.filter(v=>v==='right').length};
    }
    text($('quiz-count'),n);
    text($('right-count'),right);
    text($('reading-count'),Object.keys(data.reading).length);
    text($('sync-time'),when(data.local[S.LAST_SUCCESS]));
    if(data.local[S.LAST_ERROR])status('同步提醒：'+data.local[S.LAST_ERROR],true);
    const reading=$('readings');
    reading.replaceChildren();
    const latest=Object.entries(data.reading).sort((a,b)=>b[1].updated-a[1].updated).slice(0,12);
    if(!latest.length){
      const e=document.createElement('p');e.className='empty';text(e,'打开任意课程，滚动阅读后会在这里显示最近位置。');reading.append(e);
    }
    for(const [route,value] of latest){
      const c=S.courseOfRoute(route);
      const a=document.createElement('a');
      a.href=S.resumeUrl(route);a.target='_blank';a.rel='noopener noreferrer';a.className='reading';
      const top=document.createElement('div');top.className='reading-top';
      const label=document.createElement('span');label.className='reading-name';
      const sub=value.title && value.title!==courseTitle(c) ? value.title : route.split('/').slice(2).join(' / ');
      text(label,courseTitle(c)+' · '+(sub||'总目录'));
      const pct=document.createElement('span');pct.className='reading-pct';text(pct,Math.round(value.percent)+'%');
      top.append(label,pct);
      const track=document.createElement('div');track.className='track';
      const fill=document.createElement('span');fill.style.width=Math.round(value.percent)+'%';track.append(fill);
      a.append(top,track);reading.append(a);
    }
    const courses=$('courses');
    courses.replaceChildren();
    const sorted=Object.entries(courseStats).sort((a,b)=>b[1].count-a[1].count);
    if(!sorted.length){
      const e=document.createElement('p');e.className='empty';text(e,'尚未发现做题记录，网站现有数据会自动读入。');courses.append(e);
    }
    for(const [course,s] of sorted){
      const row=document.createElement('div');row.className='paper';
      const name=document.createElement('span');text(name,courseTitle(course));
      const amount=document.createElement('strong');text(amount,s.count+' 题 · 答对 '+s.right);
      row.append(name,amount);courses.append(row);
    }
  }
  $('sync').addEventListener('click',async()=>{
    $('sync').disabled=true;
    try {
      const tab=await activeSiteTab();
      if(!tab){status('请先打开 HFUT-CS-Online 网站，再执行立即同步。');return;}
      const result=await chrome.tabs.sendMessage(tab.id,{type:'SYNC_NOW'});
      await render();
      if(result?.error)status('同步失败：'+result.error,true);
      else if(result?.pending)status('已接收数据。当前做题页可能仍显示旧结果，请刷新网页。');
      else status('已同步到浏览器云存储。其他设备可能需要稍后刷新。');
    } catch { status('未能联系网页扩展脚本。请刷新网站后重试。',true); }
    finally{$('sync').disabled=false;}
  });
  $('reload').addEventListener('click',async()=>{
    const tab=await activeSiteTab();
    if(!tab){status('请先打开 HFUT-CS-Online 网站。');return;}
    try{await chrome.tabs.reload(tab.id);status('网页已刷新，将重新读取云端数据。');}
    catch{status('浏览器无法刷新该页面，请手动刷新。',true);}
  });
  $('visit').addEventListener('click',()=>chrome.tabs.create({url:S.SITE_URL+'#/'}));
  $('export').addEventListener('click',async()=>{
    try {
      const data=await combined();
      const backup={format:'HFUT-Site-Sync',version:2,exportedAt:new Date().toISOString(),records:data.records,reading:data.reading};
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');anchor.href=url;anchor.download='hfut-site-sync-backup.json';
      anchor.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
      status('已导出全站学习记录备份。');
    } catch(err){status('导出失败：'+err.message,true);}
  });
  $('import').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    try {
      if(file.size>2_000_000)throw Error('备份文件过大');
      const input=JSON.parse(await file.text());
      if(input.format!=='HFUT-Site-Sync'||input.version!==2)throw Error('备份格式或版本不匹配');
      const data=await combined();
      const records=S.mergeAll(data.records,input.records||{});
      const reading=S.mergeReading(data.reading,input.reading||{});
      const writes={};
      for(const [course,rows] of Object.entries(records)){
        for(const [part,entries] of Object.entries(S.shardCourse(rows))){
          const item={version:2,entries};
          if(new TextEncoder().encode(JSON.stringify(item)).byteLength>7500)throw Error('题库记录超出同步限制：'+course);
          writes[S.quizKey(course,Number(part))]=item;
        }
      }
      for(const [course,entries] of Object.entries(S.groupedReading(reading))){
        const item={version:2,entries};
        if(new TextEncoder().encode(JSON.stringify(item)).byteLength>7500)throw Error('阅读记录超出同步限制：'+course);
        writes[S.readKey(course)]=item;
      }
      const existing=data.local[S.STATE_KEY]||{};
      await chrome.storage.local.set({[S.STATE_KEY]:{...existing,records,reading}});
      if(Object.keys(writes).length)await chrome.storage.sync.set(writes);
      await render();
      status('导入完成。请刷新网站以恢复题目进度；阅读记录在下方可点击继续。');
    }catch(err){status('导入失败：'+err.message,true);}
    finally{e.target.value='';}
  });
  try{await render();}catch(err){status('读取同步数据失败：'+err.message,true);}
  chrome.storage.onChanged.addListener((_changes,area)=>{
    if(area==='sync'||area==='local')render().catch(()=>{});
  });
})();
