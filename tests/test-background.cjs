const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
const values={}, requests=[];
let listener=null;
let failExchange=false;
let simulatedNow=1900000000000;
class MockDate extends Date { static now(){return simulatedNow;} }
const chrome={
  runtime:{onMessage:{addListener(fn){listener=fn;}}},
  storage:{local:{
    async get(key){const keys=typeof key==='string'?[key]:key;return Object.fromEntries(keys.filter(x=>x in values).map(x=>[x,structuredClone(values[x])]));},
    async set(changes){Object.assign(values,structuredClone(changes));},
    async remove(keys){for(const k of(Array.isArray(keys)?keys:[keys]))delete values[k];}
  }}
};
async function fetchMock(url,options){
  requests.push({url,options});
  if(url.endsWith('/login'))return {ok:true,json:async()=>({token:'test-jwt',user:{id:7,username:'student',email:'test@example.test'}})};
  if(url.endsWith('/site-sync/exchange')){
    if(failExchange)return {ok:false,status:503,json:async()=>({error:'Cloudflare 服务不可用'})};
    return {ok:true,json:async()=>({records:{net:{q1:{v:'right',t:5,d:'desktop'}}},reading:{},controls:{}})};
  }
  if(url.endsWith('/site-sync/course'))return {ok:true,json:async()=>({control:{disabled:true,t:7,d:'mobile'}})};
  if(url.endsWith('/site-sync'))return {ok:true,json:async()=>({success:true})};
  throw Error('unexpected route');
}
const vmContext={chrome,fetch:fetchMock,setTimeout,clearTimeout,AbortController,console,Date:MockDate};
vm.runInNewContext(script,vmContext);
function call(msg){
  return new Promise((resolve,reject)=>{
    const keep=listener(msg,{id:'internal'},resolve);
    if(!keep)reject(Error('async callback not registered'));
  });
}
(async()=>{
  assert.equal((await call({type:'REMOTE_STATUS'})).enabled,false);
  const logged=await call({type:'REMOTE_LOGIN',username:'student',password:'unretained-password'});
  assert.equal(logged.ok,true);
  assert.equal(values.hfutsite_remote_session.user.username,'student');
  assert.equal(JSON.stringify(values).includes('unretained-password'),false,'never persist plaintext password');
  assert.equal((await call({type:'REMOTE_STATUS'})).enabled,true);
  const exchangeCount=()=>requests.filter(r=>r.url.endsWith('/site-sync/exchange')).length;
  // Several tabs requesting auto sync simultaneously must make ONE Cloudflare call.
  const arrivals=await Promise.all(Array.from({length:6},()=>call({
    type:'REMOTE_EXCHANGE',records:{net:{q1:{v:'right',t:5,d:'desktop'}}}
  })));
  assert.equal(exchangeCount(),1,'multiple tabs share one automatic request');
  assert.equal(arrivals.filter(r=>r.ok&&!r.skipped).length,1);
  assert.equal(arrivals.filter(r=>r.skipped).length,5);
  assert.equal(arrivals[0].records.net.q1.v,'right');
  simulatedNow+=60*1000;
  const skipped=await call({type:'REMOTE_EXCHANGE',records:{}});
  assert.equal(skipped.skipped,true,'automatic requests must honor 5-minute interval');
  assert.equal(exchangeCount(),1);
  // User action bypasses the 5-minute auto cooldown, then restarts that cooldown.
  simulatedNow+=30*1000;
  const manual=await call({type:'REMOTE_EXCHANGE',manual:true,records:{}});
  assert.equal(manual.ok,true);
  assert.equal(manual.skipped,undefined);
  assert.equal(exchangeCount(),2);
  simulatedNow+=299999;
  assert.equal((await call({type:'REMOTE_EXCHANGE',records:{}})).skipped,true);
  assert.equal(exchangeCount(),2);
  simulatedNow+=1;
  assert.equal((await call({type:'REMOTE_EXCHANGE',records:{}})).skipped,undefined);
  assert.equal(exchangeCount(),3,'auto exchange allowed again after 5 minutes');
  // Restart MV3 service worker: local storage must retain throttle across restarts.
  vm.runInNewContext(script,vmContext);
  assert.equal((await call({type:'REMOTE_EXCHANGE',records:{}})).skipped,true);
  assert.equal(exchangeCount(),3,'worker restarts cannot reset cooldown');
  // Failures are also throttled automatically, but manual retry stays available.
  failExchange=true;
  const failed=await call({type:'REMOTE_EXCHANGE',manual:true,records:{}});
  assert.equal(failed.ok,false);
  assert.equal(failed.enabled,true,'network errors must not be mistaken for a signed-out state');
  assert.match(failed.error,/Cloudflare/);
  assert.equal((await call({type:'REMOTE_EXCHANGE',records:{}})).skipped,true);
  assert.equal(exchangeCount(),4,'failed request should not cause an auto retry storm');
  failExchange=false;
  assert.equal((await call({type:'REMOTE_EXCHANGE',manual:true,records:{}})).ok,true);
  assert.equal(exchangeCount(),5,'manual retry works immediately');
  assert.equal(requests.at(-1).options.headers.Authorization,'Bearer test-jwt');
  const course=await call({type:'REMOTE_COURSE',course:'net',disabled:true,t:7,d:'mobile'});
  assert.equal(course.control.disabled,true);
  assert.equal((await call({type:'REMOTE_DELETE_ALL'})).ok,true);
  assert.equal((await call({type:'REMOTE_LOGOUT'})).ok,true);
  assert.equal((await call({type:'REMOTE_STATUS'})).enabled,false);
  assert.equal(values.hfutsite_remote_session,undefined);
  assert.equal(values.hfutsite_remote_last_attempt,undefined,'logout clears cooldown');
  const loginAgain=await call({type:'REMOTE_LOGIN',username:'student',password:'again'});
  assert.equal(loginAgain.ok,true);
  assert.equal((await call({type:'REMOTE_EXCHANGE',records:{}})).skipped,undefined,'new account session can sync immediately');
  console.log('PASS: 5-minute rate limit across tabs/restarts, manual bypass, error backoff, login and logout');
})().catch(e=>{console.error(e);process.exitCode=1;});
