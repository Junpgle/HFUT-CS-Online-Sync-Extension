const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
const values={}, requests=[];
let listener=null;
let failExchange=false;
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
vm.runInNewContext(script,{chrome,fetch:fetchMock,setTimeout,clearTimeout,AbortController,console});
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
  const sync=await call({type:'REMOTE_EXCHANGE',records:{net:{q1:{v:'right',t:5,d:'desktop'}}}});
  assert.equal(sync.ok,true);
  assert.equal(sync.records.net.q1.v,'right');
  failExchange=true;
  const failed=await call({type:'REMOTE_EXCHANGE',records:{}});
  assert.equal(failed.ok,false);
  assert.equal(failed.enabled,true,'signed-in network errors must not be mistaken for disabled cloud sync');
  assert.match(failed.error,/Cloudflare/);
  failExchange=false;
  assert.equal(requests.at(-1).options.headers.Authorization,'Bearer test-jwt');
  const course=await call({type:'REMOTE_COURSE',course:'net',disabled:true,t:7,d:'mobile'});
  assert.equal(course.control.disabled,true);
  assert.equal((await call({type:'REMOTE_DELETE_ALL'})).ok,true);
  assert.equal((await call({type:'REMOTE_LOGOUT'})).ok,true);
  assert.equal((await call({type:'REMOTE_STATUS'})).enabled,false);
  assert.equal(values.hfutsite_remote_session,undefined);
  console.log('PASS: login, protected exchange, remote course control, delete and logout');
})().catch(e=>{console.error(e);process.exitCode=1;});
