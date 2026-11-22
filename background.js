/* Optional Question-Bank account sync transport.
 * Only this privileged service worker talks to the remote API.
 * The website content script never receives or stores the JWT/password. */
const API = 'https://worker.junpgle.me/api';
const KEY = 'hfutsite_remote_session';
const LAST = 'hfutsite_remote_last';
const ERROR = 'hfutsite_remote_error';
let exchangeQueue = Promise.resolve();
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
  const message = String(e?.name==='AbortError'?'连接超时，请检查网络':e?.message||e).slice(0,240);
  await chrome.storage.local.set({[ERROR]:message});
  return {ok:false,error:message,expired:e?.status===401};
}
async function handler(msg){
  if(msg?.type==='REMOTE_STATUS'){
    const session=await currentSession();
    const state=await chrome.storage.local.get([LAST,ERROR]);
    return {ok:true,enabled:!!session,username:session?.user?.username||'',
      last:state[LAST]||0,error:state[ERROR]||''};
  }
  if(msg?.type==='REMOTE_LOGIN'){
    const username=typeof msg.username==='string'?msg.username.trim():'';
    const password=typeof msg.password==='string'?msg.password:'';
    if(!username||!password)return {ok:false,error:'请输入 Question-Bank 的用户名和密码'};
    try{
      const result=await apiCall('/login','POST',{username,password});
      if(!result.token||!result.user?.id)throw new Error('服务器未提供有效会话');
      await chrome.storage.local.set({[KEY]:{token:result.token,user:{id:result.user.id,username:result.user.username}},[ERROR]:''});
      return {ok:true,username:result.user.username};
    }catch(e){return recordError(e);}
  }
  if(msg?.type==='REMOTE_LOGOUT'){
    await chrome.storage.local.remove([KEY,LAST,ERROR]);
    return {ok:true};
  }
  if(msg?.type==='REMOTE_EXCHANGE'){
    const session=await currentSession();
    if(!session)return {ok:true,enabled:false};
    // Serialize instead of deduplicating: simultaneous tabs may have
    // different unsent progress; dropping a request would lose its changes.
    const operation=exchangeQueue.then(async()=>{
      try{
        const result=await apiCall('/site-sync/exchange','POST',{
          records:msg.records||{},reading:msg.reading||{},controls:msg.controls||{}
        },session.token);
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
      await chrome.storage.local.set({[ERROR]:'',[LAST]:0});
      return {ok:true};
    }catch(e){return recordError(e);}
  }
  return {ok:false,error:'未知操作'};
}
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(typeof message?.type!=='string'||!message.type.startsWith('REMOTE_'))return false;
  handler(message).then(sendResponse).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));
  return true;
});
