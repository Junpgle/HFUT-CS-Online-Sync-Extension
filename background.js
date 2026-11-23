/* Optional Question-Bank account sync transport.
 * Only this privileged service worker talks to the remote API.
 * The website content script never receives or stores the JWT/password. */
const API = 'https://worker.junpgle.me/api';
const KEY = 'hfutsite_remote_session';
const LAST = 'hfutsite_remote_last';
const ERROR = 'hfutsite_remote_error';
const LAST_ATTEMPT = 'hfutsite_remote_last_attempt';
const AUTO_INTERVAL_MS = 5 * 60 * 1000; // One automatic API request per profile, not per tab.
let exchangeQueue = Promise.resolve();

const METRICS = 'hfutsite_study_metrics_v1';
const TICK = 'hfutsite_study_last_tick_v1';
let metricQueue=Promise.resolve();
function metricDay(s) {return typeof s==='string' && /^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(s);}
function metricKey(s) {return typeof s==='string' && /^[a-z][a-z0-9-]{1,17}:[A-Za-z0-9:_-]{1,130}$/.test(s);}
function mergeMetrics(a,b) {
  const out={};
  const min=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
  const max=new Date(Date.now()+86400000).toISOString().slice(0,10);
  for(const day of new Set([...Object.keys(a||{}),...Object.keys(b||{})])) {
    if(!metricDay(day)||day<min||day>max)continue;
    const x=a?.[day]||{},y=b?.[day]||{},seconds={};
    for(const [d,v] of Object.entries({...x.seconds,...y.seconds}))
      if(d.length>0&&d.length<=90&&Number.isSafeInteger(v)&&v>=0&&v<=86400)seconds[d]=v;
    for(const [d,v] of Object.entries(x.seconds||{}))
      if(Object.hasOwn(seconds,d)&&Number.isSafeInteger(v))seconds[d]=Math.max(v,seconds[d]);
    const questions=[...new Set([...(Array.isArray(x.questions)?x.questions:[]),
      ...(Array.isArray(y.questions)?y.questions:[])].filter(metricKey))].sort().slice(0,3000);
    out[day]={seconds,questions};
  }
  return out;
}
function metricTransaction(job){
  const task=metricQueue.then(job);
  metricQueue=task.then(()=>{},()=>{});
  return task;
}
async function studyActivity(msg){
  return metricTransaction(async()=>{
    const now=Date.now(),day=msg.day,device=msg.device;
    const min=new Date(now-86400000).toISOString().slice(0,10);
    const max=new Date(now+86400000).toISOString().slice(0,10);
    if(!metricDay(day)||day<min||day>max || typeof device!=='string' ||
       !/^[A-Za-z0-9_-]{6,90}$/.test(device))return {ok:false,error:'无效的学习统计数据'};
    const values=await chrome.storage.local.get([METRICS,TICK]);
    const metrics=mergeMetrics(values[METRICS]||{},{});
    const row=metrics[day]||{seconds:{},questions:[]};
    const previous=values[TICK]||0;
    // A single shared timestamp across visible tabs prevents double-counting.
    if(msg.active===true&&now-previous>=14000) {
      row.seconds[device]=Math.min(86400,(row.seconds[device]||0)+15);
      await chrome.storage.local.set({[TICK]:now});
    }
    if(Array.isArray(msg.questions)){
      row.questions=[...new Set([...row.questions,...msg.questions.slice(0,100).filter(metricKey)])].sort().slice(0,3000);
    }
    metrics[day]=row;
    await chrome.storage.local.set({[METRICS]:metrics});
    return {ok:true};
  });
}

async function currentSession() {
  return (await chrome.storage.local.get(KEY))[KEY] || null;
}
async function apiCall(route, method='POST', data, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const headers={};
    if(data!==undefined)headers['Content-Type']='application/json';
    if(token)headers.Authorization='Bearer '+token;
    const response=await fetch(API+route,{method,headers,body:data===undefined?undefined:JSON.stringify(data),cache:'no-store',signal:controller.signal});
    const body=await response.json().catch(()=>({error:'服务器没有返回有效 JSON'}));
    if(!response.ok){
      const err=new Error(body.error||('HTTP '+response.status));
      err.status=response.status;throw err;
    }
    return body;
  } finally { clearTimeout(timeout); }
}
async function recordError(e) {
  const expired=e?.status===401;
  const message=expired?'账号凭据已失效（例如修改密码后），请重新登录 Question-Bank。':
    String(e?.name==='AbortError'?'连接超时，请检查网络':e?.message||e).slice(0,240);
  // Password recovery increments the account token version, invalidating all
  // older JWTs. Remove invalid credentials rather than polling indefinitely.
  if(expired)await chrome.storage.local.remove([KEY,LAST_ATTEMPT]);
  await chrome.storage.local.set({[ERROR]:message});
  return {ok:false,enabled:!expired,error:message,expired};
}
async function handler(msg){
  if(msg?.type==='STUDY_ACTIVITY')return studyActivity(msg);
  if(msg?.type==='STUDY_STATS'){
    await metricQueue;
    const data=(await chrome.storage.local.get(METRICS))[METRICS]||{};
    return {ok:true,metrics:mergeMetrics(data,{})};
  }
  if(msg?.type==='REMOTE_STATUS'){
    const session=await currentSession();
    const state=await chrome.storage.local.get([LAST,ERROR,LAST_ATTEMPT]);
    return {ok:true,enabled:!!session,username:session?.user?.username||'',
      last:state[LAST]||0,error:state[ERROR]||'',
      nextAutoAt:(state[LAST_ATTEMPT]||0)+AUTO_INTERVAL_MS,autoIntervalMs:AUTO_INTERVAL_MS};
  }
  if(msg?.type==='REMOTE_LOGIN'){
    const username=typeof msg.username==='string'?msg.username.trim():'';
    const password=typeof msg.password==='string'?msg.password:'';
    if(!username||!password)return {ok:false,error:'请输入 Question-Bank 的用户名和密码'};
    try{
      const result=await apiCall('/login','POST',{username,password});
      if(!result.token||!result.user?.id)throw new Error('服务器未提供有效会话');
      await chrome.storage.local.set({[KEY]:{token:result.token,user:{id:result.user.id,username:result.user.username}},[ERROR]:''});
      // A new login must not inherit the previous account's sync schedule.
      await chrome.storage.local.remove([LAST,LAST_ATTEMPT]);
      return {ok:true,username:result.user.username};
    }catch(e){return recordError(e);}
  }
  if(msg?.type==='REMOTE_LOGOUT'){
    await chrome.storage.local.remove([KEY,LAST,ERROR,LAST_ATTEMPT]);
    return {ok:true};
  }
  if(msg?.type==='REMOTE_EXCHANGE'){
    const session=await currentSession();
    if(!session)return {ok:true,enabled:false};
    // Serialize instead of deduplicating: simultaneous tabs may have
    // different unsent progress; dropping a request would lose its changes.
    const operation=exchangeQueue.then(async()=>{
      try{
        const now=Date.now();
        if(msg.manual!==true){
          // Service worker owns the throttle. Multiple tabs and MV3 worker
          // restarts share this timestamp through extension-local storage.
          const stamp=(await chrome.storage.local.get(LAST_ATTEMPT))[LAST_ATTEMPT]||0;
          if(now-stamp>=0 && now-stamp<AUTO_INTERVAL_MS)
            return {ok:true,enabled:true,skipped:true,nextAutoAt:stamp+AUTO_INTERVAL_MS};
        }
        // Record attempts, including network failures, to avoid retry storms.
        // User-initiated sync bypasses the interval but resets its clock.
        await chrome.storage.local.set({[LAST_ATTEMPT]:now});
        await metricQueue;
        const local=(await chrome.storage.local.get(METRICS))[METRICS]||{};
        const result=await apiCall('/site-sync/exchange','POST',{
          records:msg.records||{},reading:msg.reading||{},controls:msg.controls||{},
          metrics:mergeMetrics(local,{})
        },session.token);
        await metricTransaction(async()=>{
          const old=(await chrome.storage.local.get(METRICS))[METRICS]||{};
          await chrome.storage.local.set({[METRICS]:mergeMetrics(old,result.metrics||{})});
        });
        await chrome.storage.local.set({[LAST]:Date.now(),[ERROR]:''});
        return {ok:true,enabled:true,records:result.records||{},reading:result.reading||{},
          controls:result.controls||{},version:result.version};
      }catch(e){return recordError(e);}
    });
    exchangeQueue=operation.then(()=>{},()=>{});
    return operation;
  }
  if(msg?.type==='REMOTE_COURSE'){
    const session=await currentSession();
    if(!session)return {ok:true,enabled:false};
    try{
      const result=await apiCall('/site-sync/course','POST',{
        course:msg.course,disabled:msg.disabled,t:msg.t,d:msg.d
      },session.token);
      await chrome.storage.local.set({[ERROR]:''});
      return {ok:true,enabled:true,control:result.control};
    }catch(e){return recordError(e);}
  }
  if(msg?.type==='REMOTE_DELETE_ALL'){
    const session=await currentSession();
    if(!session)return {ok:false,error:'尚未登录'};
    try{
      await apiCall('/site-sync','DELETE',undefined,session.token);
      await chrome.storage.local.set({[ERROR]:'',[LAST]:0,[LAST_ATTEMPT]:Date.now()});
      return {ok:true};
    }catch(e){return recordError(e);}
  }
  return {ok:false,error:'未知操作'};
}
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(typeof message?.type!=='string'||
     !(message.type.startsWith('REMOTE_')||message.type==='STUDY_ACTIVITY'||message.type==='STUDY_STATS'))return false;
  handler(message).then(sendResponse).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));
  return true;
});
