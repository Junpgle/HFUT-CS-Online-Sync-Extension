/* Browser-independent integration test: two devices, shared extension sync, independent page localStorage. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const shared=fs.readFileSync(path.join(__dirname,'../shared.js'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
const cloud={};
const cloudListeners=[];
let deviceNo=0;
const clone=x=>structuredClone(x);
function device(initial={},hash='#/net') {
  const site={};
  for(const [key,value] of Object.entries(initial))site[key]=JSON.stringify(value);
  const own={}, timers=[], events={}, pageEvents={};
  const remoteMessages=[];
  let contentMessageHandler=null;
  const storage={
    local:{
      async get(key){if(typeof key==='string')return {[key]:clone(own[key])};return {};},
      async set(obj){Object.assign(own,clone(obj));}
    },
    sync:{
      async get(){return clone(cloud);},
      async set(obj){
        const changes={};
        for(const [key,value] of Object.entries(obj)){
          if(JSON.stringify(cloud[key])===JSON.stringify(value))continue;
          changes[key]={oldValue:clone(cloud[key]),newValue:clone(value)};
          cloud[key]=clone(value);
        }
        if(Object.keys(changes).length)queueMicrotask(()=>{
          for(const fn of cloudListeners)fn(changes,'sync');
        });
      },
      async remove(keys){
        const changes={};
        for(const key of (Array.isArray(keys)?keys:[keys])){
          if(!(key in cloud))continue;
          changes[key]={oldValue:clone(cloud[key]),newValue:undefined};
          delete cloud[key];
        }
        if(Object.keys(changes).length)queueMicrotask(()=>{
          for(const fn of cloudListeners)fn(changes,'sync');
        });
      }
    },
    onChanged:{addListener(fn){cloudListeners.push(fn)}}
  };
  const localStorage={
    get length(){return Object.keys(site).length;},
    key(i){return Object.keys(site)[i]||null;},
    getItem(k){return site[k]??null;},
    setItem(k,v){site[k]=String(v);}
  };
  const loc={hash,reloads:0,reload(){this.reloads++}};
  const win={scrollY:0,innerHeight:800,scrollTo(){},addEventListener(){}};
  const doc={
    title:'Test Course',body:{scrollHeight:5000},documentElement:{scrollHeight:5000},
    querySelector(){return null;},querySelectorAll(){return []},
    addEventListener(event,cb){pageEvents[event]=cb;},visibilityState:'visible'
  };
  const context={
    console,chrome:{storage,runtime:{
      onMessage:{addListener(fn){contentMessageHandler=fn;}},
      async sendMessage(message){remoteMessages.push(message);return {ok:true,enabled:false};}
    }},
    localStorage,location:loc,window:win,document:doc,TextEncoder,
    crypto:{randomUUID(){return 'unit-device-'+(++deviceNo)}},
    addEventListener(event,cb){events[event]=cb;},
    clearTimeout,setTimeout,setInterval(cb){timers.push(cb);}
  };
  vm.createContext(context);
  vm.runInContext(shared,context);
  vm.runInContext(script,context);
  return {context,site,loc,win,events,timers,localStorage,storage,remoteMessages,
    message(msg){return new Promise(resolve=>contentMessageHandler(msg,null,resolve));},
    get(key){return JSON.parse(site[key]||'{}');},
    set(key,obj){site[key]=JSON.stringify(obj);}
  };
}
async function settle(ms=180){await new Promise(done=>setTimeout(done,ms));}
async function main(){
  const netKey='net-practice-progress-v1',osKey='os-practice-progress-v1';
  const a=device({[netKey]:{s1:'right'}});
  await settle();
  assert.equal(cloudListeners.length,1);
  const b=device({[osKey]:{s1:'wrong'}},'#/os');
  await settle();
  assert.equal(a.get(netKey).s1,'right');
  assert.equal(b.get(netKey).s1,'right');
  assert.equal(a.get(osKey).s1,'wrong');
  assert.equal(b.get(osKey).s1,'wrong');
  assert.equal(Object.keys(cloud).filter(k=>k.startsWith('hfutsite_v2_q_')).length,2);
  a.set(netKey,{...a.get(netKey),s2:'revealed'});
  a.timers[0]();
  await settle();
  assert.equal(b.get(netKey).s2,'revealed');
  b.set(osKey,{});
  b.timers[0]();
  await settle();
  assert.deepEqual(a.get(osKey),{});
  assert.deepEqual(b.get(osKey),{});
  assert.equal(a.get(netKey).s1,'right','clearing OS must not alter network records');
  const S=a.context.HFUTSiteSync;
  assert.equal(S.cloudQuiz(cloud).os.s1.v,null,'deleted answers remain as tombstones');
  a.loc.hash='#/net/deck/ch4';
  a.win.scrollY=640;
  a.events.pagehide();
  await settle();
  assert.ok(cloud[S.readKey('net')].entries['#/net/deck/ch4'].y===640,'net reading position in cloud');
  assert.equal(b.loc.reloads,0);

  // Cloud cleanup: opt-out first, then remove the course's question+reading shards.
  await a.storage.sync.set({[S.disabledKey('net')]:{disabled:true,updated:Date.now()}});
  await a.storage.sync.remove(S.courseCloudKeys(cloud,'net'));
  await settle(300);
  assert.equal(S.courseCloudKeys(cloud,'net').length,0,'net cloud data must be deleted');
  assert.equal(a.get(netKey).s1,'right','original website answers must remain untouched');
  a.timers[0]();b.timers[0]();
  await settle(300);
  assert.equal(S.courseCloudKeys(cloud,'net').length,0,
    'other active devices must NOT re-upload the disabled course');
  assert.equal(b.get(osKey).s1,undefined,'OS clear tombstone is preserved');

  // Re-enabling should repopulate from the site's own localStorage on open tabs.
  await a.storage.sync.remove(S.disabledKey('net'));
  await settle(300);
  a.timers[0]();
  await settle(300);
  assert.equal(S.cloudQuiz(cloud).net.s1.v,'right','re-enable imports local website answers');
  // Clicking the popup sync button must make exactly one forced remote exchange,
  // not a throttled auto request followed by a second forced request.
  const before=a.remoteMessages.filter(m=>m.type==='REMOTE_EXCHANGE').length;
  const manual=await a.message({type:'SYNC_NOW'});
  const after=a.remoteMessages.filter(m=>m.type==='REMOTE_EXCHANGE').slice(before);
  assert.equal(manual.ok,true);
  assert.equal(after.length,1,'manual click triggers exactly one remote exchange');
  assert.equal(after[0].manual,true,'manual click bypasses the automatic interval');
  console.log('PASS: two devices, course isolation, tombstones, reading, opt-out, cloud purge and re-enable');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
