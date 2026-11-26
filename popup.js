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
      return t?.id && u.startsWith(S.SITE_URL) ? t : null;
    });
  }
  async function requestSiteSync(tab) {
    try {
      const result=await chrome.tabs.sendMessage(tab.id,{type:'SYNC_NOW'});
      if(!result?.ok)throw new Error(result?.error||'网页同步脚本尚未就绪，请刷新网页后重试。');
      return result;
    }catch(err) {
      if(/receiving end does not exist|could not establish connection|extension context invalidated/i.test(String(err?.message||err)))
        throw new Error('网页扩展脚本已失效或尚未加载，请刷新 HFUT-CS-Online 网页后重试。');
      throw err;
    }
  }
  async function combined() {
    const [cloud,local]=await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get([S.STATE_KEY,S.LAST_SUCCESS,S.LAST_ERROR])
    ]);
    const device=local[S.STATE_KEY]||{};
    const disabled=S.disabledCourses(cloud);
    for(const [course,control] of Object.entries(device.remoteControls||{})){
      if(control?.disabled===true)disabled[course]=true;
    }
    const records=S.mergeAll(S.cloudQuiz(cloud),device.records||{});
    const reading=S.mergeReading(S.cloudReading(cloud),device.reading||{});
    for(const c of Object.keys(disabled)){
      delete records[c];
      for(const route of Object.keys(reading))
        if(S.courseOfRoute(route)===c)delete reading[route];
    }
    return {cloud,local,records,reading,disabled};
  }
  function courseTitle(c) { return S.TITLES[c]||c.toUpperCase(); }
  const bytes=n=>n<1024?n+' B':(n/1024).toFixed(n<10240?1:0)+' KiB';
  let renderToken=0;
  async function disableCourse(c) {
    const name=courseTitle(c);
    if(!confirm('清除「'+name+'」的云端答题和阅读记录，并停止同步？\n\n网站本地做题记录不会删除，之后可恢复同步。'))return;
    try{
      // Prefer opt-out first to stop other devices reuploading this course.
      // If the sync area is already full, free this course's bytes first.
      const control={[S.disabledKey(c)]:{disabled:true,updated:Date.now()}};
      try{
        await chrome.storage.sync.set(control);
      }catch(err){
        if(!/QUOTA_BYTES|MAX_ITEMS|quota|storage.*full/i.test(String(err?.message||err)))throw err;
        const before=await chrome.storage.sync.get(null);
        const keys=S.courseCloudKeys(before,c);
        if(!keys.length)throw err;
        await chrome.storage.sync.remove(keys);
        await chrome.storage.sync.set(control);
      }
      for(let attempt=0;attempt<2;attempt++){
        const cloud=await chrome.storage.sync.get(null);
        const keys=S.courseCloudKeys(cloud,c);
        if(keys.length)await chrome.storage.sync.remove(keys);
      }
      const device=(await chrome.storage.local.get(S.STATE_KEY))[S.STATE_KEY]?.deviceId||'unknown';
      const remote=await chrome.runtime?.sendMessage?.({type:'REMOTE_COURSE',course:c,disabled:true,t:control[S.disabledKey(c)].updated,d:device});
      await render();
      if(remote?.enabled&&remote?.ok===false)
        status('浏览器云端已清除，但 Question-Bank 云端未更新：'+remote.error,true);
      else status('已清除「'+name+'」云端同步记录。网站本地数据仍保留。');
    }catch(e){
      await render().catch(()=>{});
      status('清除失败：'+e.message+'。请重试。',true);
    }
  }
  async function enableCourse(c){
    try{
      await chrome.storage.sync.remove(S.disabledKey(c));
      const device=(await chrome.storage.local.get(S.STATE_KEY))[S.STATE_KEY]?.deviceId||'unknown';
      const remote=await chrome.runtime?.sendMessage?.({type:'REMOTE_COURSE',course:c,disabled:false,t:Date.now(),d:device});
      await render();
      if(remote?.enabled&&remote?.ok===false)
        status('浏览器同步已恢复，Question-Bank 云端更新失败：'+remote.error,true);
      else status('已恢复「'+courseTitle(c)+'」同步。打开或刷新课程网页后会重新上传本地记录。');
    }catch(e){status('恢复同步失败：'+e.message,true);}
  }

  function localDay(d){
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function displayDuration(seconds){
    const minutes=Math.floor(seconds/60);
    return minutes>=60?Math.floor(minutes/60)+' 小时 '+minutes%60+' 分钟':minutes+' 分钟';
  }
  async function renderStudy(){
    const result=await chrome.runtime.sendMessage({type:'STUDY_STATS'});
    if(!result?.ok)return;
    const metrics=result.metrics||{},today=localDay(new Date());
    const stats=day=>{
      const row=metrics[day]||{};
      return {seconds:Object.values(row.seconds||{}).reduce((a,b)=>a+(Number(b)||0),0),
        questions:new Set(row.questions||[]).size};
    };
    const current=stats(today);
    text($('study-minutes'),displayDuration(current.seconds));
    text($('study-questions'),current.questions+' 题');
    const days=Array.from({length:7},(_,i)=>{
      const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-(6-i));
      return {day:localDay(d),weekday:['日','一','二','三','四','五','六'][d.getDay()]};
    });
    const values=days.map(({day})=>stats(day).seconds);
    const max=Math.max(60,...values);
    const chart=$('study-chart');chart.replaceChildren();
    for(let i=0;i<days.length;i++){
      const col=document.createElement('div');col.className='study-day'+(i===6?' today':'');
      const value=document.createElement('span');value.className='study-value';
      const minutes=Math.floor(values[i]/60);
      text(value,minutes>=60?(minutes/60).toFixed(1)+'h':minutes+'m');
      const wrap=document.createElement('div');wrap.className='study-bar-wrap';
      const bar=document.createElement('div');bar.className='study-bar';
      bar.style.height=(values[i]?Math.max(3,Math.round(values[i]/max*74)):0)+'px';
      wrap.append(bar);
      const label=document.createElement('span');label.className='study-day-label';
      text(label,i===6?'今天':'周'+days[i].weekday);
      col.title=days[i].day+'：'+displayDuration(values[i])+'，'+stats(days[i].day).questions+' 题';
      col.append(value,wrap,label);chart.append(col);
    }
    chart.setAttribute('aria-label','近七天学习时长：'+days.map((d,i)=>d.day+' '+Math.floor(values[i]/60)+'分钟').join('；'));
  }
  async function render() {
    const token=++renderToken;
    const data=await combined();
    const ids=new Set([
      ...Object.keys(data.records),
      ...Object.keys(S.groupedReading(data.reading)),
      ...Object.keys(S.cloudQuiz(data.cloud)),
      ...Object.keys(S.groupedReading(S.cloudReading(data.cloud))),
      ...Object.keys(data.disabled)
    ]);
    const courseList=[...ids];
    const used=await chrome.storage.sync.getBytesInUse(null);
    const sizes=Object.fromEntries(await Promise.all(courseList.map(async c=>{
      const keys=S.courseCloudKeys(data.cloud,c);
      return [c,keys.length?await chrome.storage.sync.getBytesInUse(keys):0];
    })));
    if(token!==renderToken)return;
    const quota=Number(chrome.storage.sync.QUOTA_BYTES)||102400;
    const fraction=Math.min(100,Math.round(used/quota*1000)/10);
    text($('quota-used'),bytes(used));
    text($('quota-total'),'/ '+bytes(quota));
    text($('quota-percent'),fraction.toFixed(1)+'%');
    text($('quota-free'),'剩余 '+bytes(Math.max(0,quota-used))+
      ' · 实际同步空间占用（含记录键与停用设置）');
    const bar=$('quota-fill').parentElement;
    $('quota-fill').style.width=fraction+'%';
    bar.setAttribute('aria-valuenow',String(Math.round(fraction)));
    bar.classList.toggle('warn',fraction>=80&&fraction<95);
    bar.classList.toggle('full',fraction>=95);
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
    const manage=$('course-manage');manage.replaceChildren();
    courseList.sort((a,b)=>(sizes[b]||0)-(sizes[a]||0)||courseTitle(a).localeCompare(courseTitle(b),'zh-CN'));
    if(!courseList.length){
      const e=document.createElement('p');e.className='empty';
      text(e,'暂无课程同步记录。');manage.append(e);
    }
    for(const c of courseList){
      const disabled=!!data.disabled[c];
      const row=document.createElement('div');row.className='manage-row'+(disabled?' disabled':'');
      const meta=document.createElement('div');meta.className='manage-meta';
      const title=document.createElement('div');title.className='manage-name';text(title,courseTitle(c));
      const size=document.createElement('div');size.className='manage-size';
      text(size,(disabled?'已停用 · 云端课程数据 ':'云端占用 ')+bytes(sizes[c]||0));
      meta.append(title,size);
      const button=document.createElement('button');
      button.type='button';button.className=disabled?'':'danger';
      text(button,disabled?'恢复同步':'清除并停用');
      button.title=disabled?'恢复该课程云同步':'保留网站本地数据，仅清除云端记录';
      button.addEventListener('click',async()=>{
        button.disabled=true;
        try{await (disabled?enableCourse(c):disableCourse(c));}
        finally{button.disabled=false;}
      });
      row.append(meta,button);manage.append(row);
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
      const result=await requestSiteSync(tab);
      await render();
      if(result?.error)status('同步失败：'+result.error,true);
      else if(result?.pending)status('已接收数据。当前做题页可能仍显示旧结果，请刷新网页。');
      else status('已更新浏览器同步存储。只有浏览器实际启用扩展设置同步时，才会自动传到其他设备。');
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
      let skipped=0;
      for(const course of Object.keys(data.disabled)){
        if(records[course]){delete records[course];skipped++;}
        for(const route of Object.keys(reading)){
          if(S.courseOfRoute(route)===course){delete reading[route];skipped++;}
        }
      }
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
      status('导入完成。'+(skipped?'停用课程的数据已跳过。':'')+'请刷新网站以恢复题目进度。');
    }catch(err){status('导入失败：'+err.message,true);}
    finally{e.target.value='';}
  });
  let loginExpanded=false;
  $('remote-expand').addEventListener('click',()=>{
    loginExpanded=true;
    $('remote-invite').hidden=true;
    $('remote-login-area').hidden=false;
    $('remote-expand').setAttribute('aria-expanded','true');
    $('remote-username').focus();
  });
  async function cloudStatus(){
    if(!chrome.runtime?.sendMessage)return;
    const result=await chrome.runtime.sendMessage({type:'REMOTE_STATUS'});
    if(!result?.ok)return;
    $('remote-invite').hidden=!!result.enabled;
    $('remote-login-area').hidden=!!result.enabled || !loginExpanded;
    $('remote-login-form').hidden=!!result.enabled;
    $('remote-session').hidden=!result.enabled;
    if(result.enabled) {
      text($('remote-user'),'已登录：'+result.username);
      text($('remote-last'),result.last
        ?'独立云上次成功同步：'+when(result.last)
        :'独立云尚未成功同步');
    }
    if(result.error)remoteMessage('独立云同步提醒：'+result.error,true);
  }
  function remoteMessage(message,error=false){
    const el=$('remote-message');
    text(el,message);
    el.hidden=!message;
    el.classList.toggle('error',error);
  }
  $('remote-login-form').addEventListener('submit',async e=>{
    e?.preventDefault?.();
    if(!confirm('启用 Question-Bank 独立云同步后，本机已有的 HFUT-CS-Online 做题记录与阅读位置将上传到此 Question-Bank 账号并存储在 Cloudflare。该服务不提供端到端加密。\\n\\n确认登录并启用？'))return;
    const btn=$('remote-login');
    btn.disabled=true;
    try{
      const result=await chrome.runtime.sendMessage({
        type:'REMOTE_LOGIN', username:$('remote-username').value,
        password:$('remote-password').value
      });
      $('remote-password').value=''; // Never persist plaintext passwords.
      if(!result?.ok)throw new Error(result?.error||'登录失败');
      remoteMessage('已登录 Question-Bank，正在与独立云服务交换学习记录…');
      await cloudStatus();
      const tab=await activeSiteTab();
      if(tab) {
        const synced=await requestSiteSync(tab);
        if(!synced.remoteSynced)throw new Error(synced.remoteError||'独立云未确认同步成功');
        remoteMessage('已完成独立云同步。其他设备登录同一账号后可读取记录。');
      }else remoteMessage('登录成功。打开 HFUT-CS-Online 网站后将自动同步。');
      await cloudStatus();
    }catch(err){remoteMessage('登录或同步失败：'+err.message,true);}
    finally{btn.disabled=false;}
  });
  $('remote-now').addEventListener('click',async()=>{
    const btn=$('remote-now');btn.disabled=true;
    try{
      const tab=await activeSiteTab();
      if(!tab)throw new Error('请先打开 HFUT-CS-Online 网站');
      const result=await requestSiteSync(tab);
      if(!result.remoteSynced)throw new Error(result.remoteError||'独立云未确认同步成功');
      remoteMessage('独立云双向同步完成；正在使用的做题页请刷新查看更新。');
      await render();await cloudStatus();
    }catch(err){remoteMessage('独立云同步失败：'+err.message,true);}
    finally{btn.disabled=false;}
  });
  $('remote-logout').addEventListener('click',async()=>{
    try{
      await chrome.runtime.sendMessage({type:'REMOTE_LOGOUT'});
      loginExpanded=false;
      $('remote-expand').setAttribute('aria-expanded','false');
      const tab=await activeSiteTab();
      if(tab)await chrome.tabs.sendMessage(tab.id,{type:'REMOTE_SIGNOUT'}).catch(()=>{});
      remoteMessage('已退出 Question-Bank；本机学习记录和服务器已有数据不会自动删除。');
      await cloudStatus();
    }catch(err){remoteMessage('退出失败：'+err.message,true);}
  });
  $('remote-delete').addEventListener('click',async()=>{
    if(!confirm('确定永久删除此 Question-Bank 账号在独立云端保存的 HFUT-CS-Online 记录？\\n\\n题库数据和浏览器本地数据不会被清除，重新同步可能再次上传。'))return;
    const result=await chrome.runtime.sendMessage({type:'REMOTE_DELETE_ALL'});
    if(result?.ok)remoteMessage('独立云学习记录已删除。注意：下次同步可能重新上传本地记录。');
    else remoteMessage('删除失败：'+(result?.error||'未知错误'),true);
    await cloudStatus();
  });
  try{await render();}catch(err){status('读取同步数据失败：'+err.message,true);}
  renderStudy().catch(()=>{});
  cloudStatus().catch(()=>{});
  chrome.storage.onChanged.addListener((_changes,area)=>{
    if(area==='sync'||area==='local'){
      render().catch(()=>{});
      renderStudy().catch(()=>{});
    }
  });
})();
