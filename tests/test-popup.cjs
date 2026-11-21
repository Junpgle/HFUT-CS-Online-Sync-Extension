/* Headless popup regression: real sync quota API calls and per-course cloud controls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  constructor() {
    this.children=[]; this.events={}; this.style={}; this.textContent=''; this.disabled=false;
    this.classList={toggle(){},add(){},remove(){}};
  }
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(name,value){(this.attrs??={})[name]=value;}
}
const nodes={};
const el=id=>(nodes[id]??=new Element());
el('quota-fill').parentElement=new Element();
const document={getElementById:el,createElement:()=>new Element()};
const cloud={};
const listeners=[];
const toBytes=keys=>keys.reduce((size,k)=>size+(k in cloud?k.length+JSON.stringify(cloud[k]).length:0),0);
const sync={
  QUOTA_BYTES:102400,
  async get(){return structuredClone(cloud);},
  async getBytesInUse(keys){
    const all=keys==null?Object.keys(cloud):(Array.isArray(keys)?keys:[keys]);
    return toBytes(all);
  },
  async set(values){Object.assign(cloud,structuredClone(values));},
  async remove(keys){
    for(const k of (Array.isArray(keys)?keys:[keys]))delete cloud[k];
  }
};
const chrome={
  storage:{
    sync,
    local:{
      async get(){return {};}
    },
    onChanged:{addListener(fn){listeners.push(fn);}}
  },
  tabs:{async query(){return [];},async create(){}},
  runtime:{}
};
const ctx={console,document,chrome,confirm:()=>true,TextEncoder};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared.js'),'utf8'),ctx);
const S=ctx.HFUTSiteSync;
cloud[S.quizKey('net',S.hash('s1')%16)]={version:2,entries:{s1:{v:'right',t:10,d:'pc'}}};
cloud[S.readKey('os')]={version:2,entries:{
  '#/os/chapter/ch1':{percent:50,y:350,section:null,title:'操作系统',updated:10,d:'pc'}
}};
const before=toBytes(Object.keys(cloud));
const popup=fs.readFileSync(path.join(__dirname,'../popup.js'),'utf8');
vm.runInContext(popup.replace('(async function () {','globalThis.__popupReady = (async function () {'),ctx);
(async()=>{
  await ctx.__popupReady;
  assert.match(el('quota-total').textContent,/100 KiB/);
  assert.match(el('quota-free').textContent,/剩余/);
  assert.equal(el('course-manage').children.length,2);
  const networkRow=el('course-manage').children.find(row=>
    row.children[0].children[0].textContent==='计算机网络');
  assert.ok(networkRow);
  assert.equal(networkRow.children[1].textContent,'清除并停用');
  await networkRow.children[1].events.click();
  assert.equal(S.disabledCourses(cloud).net,true);
  assert.equal(S.courseCloudKeys(cloud,'net').length,0);
  assert.ok(cloud[S.readKey('os')],'other course must survive cleanup');
  assert.ok(toBytes(Object.keys(cloud))<before,'cleanup must free space');
  const disabledRow=el('course-manage').children.find(row=>
    row.children[0].children[0].textContent==='计算机网络');
  assert.equal(disabledRow.children[1].textContent,'恢复同步');
  await disabledRow.children[1].events.click();
  assert.equal(S.disabledCourses(cloud).net,undefined);
  console.log('PASS: quota meter, course sizes, safe cloud cleanup and reenable');
})().catch(err=>{console.error(err);process.exitCode=1;});
