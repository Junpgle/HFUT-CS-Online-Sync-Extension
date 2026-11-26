const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../shared.js', 'utf8'), ctx);
const S = ctx.HFUTSiteSync;
const plain = o => JSON.parse(JSON.stringify(o));

assert.equal(S.courseOfKey('practice-progress-v1'), 'algo');
assert.equal(S.courseOfKey('net-practice-progress-v1'), 'net');
assert.equal(S.courseOfKey('os-practice-progress-v1'), 'os');
assert.equal(S.courseOfKey('theme-preference'), null);
assert.deepEqual(plain(S.sanitizeAnswers('{"s1":"right","p1-f1":"revealed","bad":"oops"}')),
  {s1:'right','p1-f1':'revealed'});
assert.deepEqual(plain(S.sanitizeAnswers('bad-json')), {});
assert.deepEqual(plain(S.sanitizeAnswers('[]')), {});
assert.equal(S.courseOfRoute('#/net/deck/ch4'),'net');
assert.equal(S.courseOfRoute('#/algo/deck/deck1'),'algo');
assert.equal(S.courseOfRoute('#/os/practice/paper2021'),null);
assert.equal(S.routeFromHash('#/math/chapter/ch8?s=sec-1'),'#/math/chapter/ch8');
assert.equal(S.routeFromHash('#/net/attachments'),null);
const delta=S.changes({s1:'right',s2:'wrong'},{s1:'wrong',s3:'revealed'},'pc',100);
assert.equal(delta.s1.v,'wrong');
assert.equal(delta.s2.v,null);
assert.equal(delta.s3.v,'revealed');
const merged=S.mergeRecords(delta,{s1:{v:'right',t:120,d:'phone'}});
assert.equal(merged.s1.v,'right');
assert.deepEqual(plain(S.actualAnswers(merged)),{s1:'right',s3:'revealed'});
const courses=S.mergeAll({net:{s1:{v:'right',t:10,d:'a'}}},{os:{s1:{v:'wrong',t:11,d:'b'}}});
assert.equal(courses.net.s1.v,'right');assert.equal(courses.os.s1.v,'wrong');
const shards=S.shardCourse({'p1-s1':{v:'right',t:100,d:'a'},'p1-s2':{v:'wrong',t:110,d:'a'}});
const cloud={};for(const [part,entries] of Object.entries(shards))cloud[S.quizKey('net',Number(part))]={version:2,entries};
assert.equal(Object.keys(S.cloudQuiz(cloud).net).length,2);
assert.equal(S.cloudQuiz({'hfutnet_v1_answers_paper-2021':{entries:{x:{v:'right',t:1,d:'d'}}}}).net,undefined);
const now=Date.now();
const read=S.mergeReading({'#/net/deck/ch4':{percent:90,y:1100,section:'sec-ch4',title:'链路层',updated:now,d:'a'}},
 {'#/net/deck/ch4':{percent:20,y:300,section:'sec-ch4',title:'链路层',updated:now-5,d:'b'},
  '#/os/chapter/ch2':{percent:30,y:400,section:'sec-os',title:'操作系统',updated:now,d:'c'}});
assert.equal(read['#/net/deck/ch4'].percent,90);
assert.equal(read['#/os/chapter/ch2'].percent,30);
const grouped=S.groupedReading(read);
assert.equal(Object.keys(grouped).length,2);
assert.equal(S.resumeUrl('#/net/deck/ch4'),
  S.SITE_URL + '#/net/deck/ch4?hfut_sync_resume=1');
assert.ok(S.hash('p1-s1') >= 0);
const control=S.disabledKey('net');
assert.equal(S.courseOfDisableKey(control),'net');
assert.equal(S.courseOfDisableKey('unrelated_key'),null);
assert.equal(S.disabledCourses({[control]:{disabled:true}}).net,true);
assert.equal(S.disabledCourses({[control]:{disabled:false}}).net,undefined);
assert.deepEqual(plain(S.courseCloudKeys({
  [S.quizKey('net',0)]:{entries:{}},[S.readKey('net')]:{entries:{}},
  [S.quizKey('os',0)]:{entries:{}},[control]:{disabled:true}
},'net')),[S.quizKey('net',0),S.readKey('net')]);
const native=S.fromNativeReading({'/net/deck/ch2':{c:'net',y:321,p:.2345,s:'数据通信',t:123}},'pc');
assert.equal(native['#/net/deck/ch2'].percent,23.45);
assert.equal(native['#/net/deck/ch2'].updated,123);
const restored=S.toNativeReading({},native);
assert.equal(restored['/net/deck/ch2'].p,.2345);
assert.equal(restored['/net/deck/ch2'].s,'数据通信');
assert.deepEqual(plain(S.toNativeReading(restored,native)),plain(restored));
assert.deepEqual(plain(S.toNativeReading({},native,{net:true})),{});
assert.equal(S.toNativeReading({'/net/deck/ch2':{t:124,y:900}},native)['/net/deck/ch2'].y,900);
assert.deepEqual(plain(S.nativeProgress({a:{t:40,r:'right'},b:{t:50,r:null},c:{t:60,r:'wrong'}},{a:'right',c:'right'},'pc')),
  {a:{v:'right',t:40,d:'pc'},b:{v:null,t:50,d:'pc'}});
assert.equal(S.TITLES.ds,'数据结构');
console.log('PASS: multi-course keys, conflict/deletion, reading, quota cleanup and disabled-course controls');
