/* Simulates two device instances with independent site+local storage and shared sync cloud. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const shared = fs.readFileSync(path.join(__dirname,'../shared.js'),'utf8');
const content = fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
const sync = {};
const listeners = [];
let nextId = 0;
const clone = x => structuredClone(x);
function mockDevice(localSite = {}) {
  const pageData = { 'net-practice-progress-v1': JSON.stringify(localSite) };
  const ownStorage = {};
  const intervals = [];
  const page = {
    getItem(k){ return pageData[k] ?? null; },
    setItem(k,v){ pageData[k] = String(v); },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) { if (typeof keys==='string') return {[keys]:clone(ownStorage[keys])};
          return Object.fromEntries((keys||[]).map(k=>[k,clone(ownStorage[k])])); },
        async set(obj){Object.assign(ownStorage,clone(obj));},
      },
      sync: {
        async get(){return clone(sync);},
        async set(obj){
          const diffs={};
          for(const [k,v] of Object.entries(obj)){
            if(JSON.stringify(sync[k])===JSON.stringify(v))continue;
            diffs[k]={oldValue:clone(sync[k]),newValue:clone(v)};
            sync[k]=clone(v);
          }
          if(Object.keys(diffs).length)queueMicrotask(()=>listeners.forEach(fn=>fn(diffs,'sync')));
        }
      },
      onChanged: {addListener(fn){listeners.push(fn);}},
    },
    runtime:{onMessage:{addListener(){} }},
  };
  const ctx={console,chrome,localStorage:page,crypto:{randomUUID:()=>`dev-${++nextId}`},
    TextEncoder, location:{hash:'#/net',reload(){this.reloads=(this.reloads||0)+1;}},
    window:{scrollY:0,innerHeight:900,addEventListener(){}},
    document:{body:{scrollHeight:3000},documentElement:{scrollHeight:3000},querySelector(){return null;},addEventListener(){}},
    addEventListener(){},clearTimeout,setTimeout,setInterval(cb){intervals.push(cb);},
  };
  vm.createContext(ctx);
  vm.runInContext(shared,ctx);vm.runInContext(content,ctx);
  return {ctx,intervals,site:()=>JSON.parse(page.getItem('net-practice-progress-v1')),setSite(x){page.setItem('net-practice-progress-v1',JSON.stringify(x));}};
}
async function settle(){for(let i=0;i<50;i++)await new Promise(r=>setTimeout(r,3));}
async function main(){
 const a=mockDevice({'paper-2021:p1-s1':'right'});await settle();
 assert.equal(sync['hfutnet_v1_answers_paper-2021'].entries['paper-2021:p1-s1'].v,'right');
 const b=mockDevice({'paper-2021:p1-s2':'wrong'});await settle();
 assert.equal(Object.keys(b.site()).length,2,'second device should restore first answer');
 assert.equal(Object.keys(a.site()).length,2,'first device should incorporate second answer');
 a.setSite({...a.site(),'paper-2021:p1-s3':'revealed'});
 a.intervals[0]();await settle();
 assert.equal(b.site()['paper-2021:p1-s3'],'revealed','live update reaches second device');
 b.setSite({});b.intervals[0]();await settle();
 assert.equal(Object.keys(a.site()).length,0,'clear answer tombstones must propagate');
 assert.equal(Object.keys(b.site()).length,0,'clearing device must stay cleared');
 assert.equal(Object.keys(sync['hfutnet_v1_answers_paper-2021'].entries).length,3);
 console.log('PASS: 2-device sync, merge, live updates and tombstone deletion');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
