import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DeviceController } from '../packages/dsh-plugin/host/device-controller.js';
import { pollOptions, windowsVoiceStateSnapshot, parseDeviceSnapshot } from '../packages/dsh-plugin/host/rpc.js';
const owner='windows_state_owner_0001';
function fixture(){
 const child=new EventEmitter(), writes=[]; child.stdout=new EventEmitter();child.stdin=new EventEmitter();
 Object.assign(child.stdin,{writable:true,write(s){writes.push(JSON.parse(s));return true;},end(){child.emit('close');}});child.kill=()=>child.emit('close');
 const observer={value:{state:'idle',error:null,level:0},starts:0,stops:0,snapshot(){return {...this.value};},start(){this.starts++;this.value={state:'idle',error:null,level:0};},stop(){this.stops++;this.value={state:'stopped',error:null,level:0};},dispose(){this.stop();}};
 const controller=new DeviceController({platform:'win32',spawnChild:()=>child,windowsVoiceStateObserver:observer,modeLease:{acquire:()=>true,release(){}}});
 controller.connect(owner);child.stdout.emit('data',Buffer.from('{"type":"status","state":"ready"}\n'));
 return {controller,observer,writes};
}
const armed={context:owner,windowsVoice:true,windowsVoiceState:true,experimentalK1Lamp:true,lights:true,channels:[2,2,2,1]};
test('Windows observer requires all opt-ins; shortcut dispatch is never recording evidence',()=>{
 const f=fixture();try{
 for(const options of [{...armed,windowsVoiceState:false},{...armed,experimentalK1Lamp:false},{...armed,lights:false},{...armed,context:null}]){
  f.controller.poll(owner,options);assert.equal(f.observer.starts,0);assert.equal(f.writes.at(-1).channels[0],0);
 }
 let result=f.controller.poll(owner,armed);assert.equal(f.observer.starts,1);assert.equal(result.windowsVoiceState.state,'idle');assert.deepEqual(f.writes.at(-1).channels,[0,2,2,1]);
 f.observer.value={state:'recording',error:null,level:0.73};result=f.controller.poll(owner,armed);
 assert.equal(parseDeviceSnapshot(result,true).windowsVoiceState.level,0.73);assert.deepEqual(f.writes.at(-1).channels,[2,2,2,1]);
 f.observer.value={state:'recording',error:null,level:0};f.controller.applyWindowsVoiceState();assert.deepEqual(f.writes.at(-1).channels,[2,2,2,1]);
 const count=f.writes.length;f.controller.applyWindowsVoiceState();assert.equal(f.writes.length,count);
 f.observer.value={state:'unknown',error:'capture_unknown',level:0};f.controller.applyWindowsVoiceState();assert.deepEqual(f.writes.at(-1).channels,[0,2,2,1]);
 f.controller.poll(owner,{...armed,experimentalK1Lamp:false});assert.ok(f.observer.stops>0);assert.equal(f.controller.snapshot().windowsVoiceState,undefined);
 }finally{f.controller.dispose();}
});
test('Windows state codec rejects raw audio, malformed peaks and false state claims',()=>{
 assert.deepEqual(windowsVoiceStateSnapshot({state:'recording',error:null,level:0.5}),{state:'recording',error:null,level:0.5});
 for(const value of [{state:'idle',error:null,level:0.1},{state:'recording',error:null,level:NaN},{state:'recording',error:null,level:2},{state:'recording',error:null,level:0,audio:'raw'}])assert.throws(()=>windowsVoiceStateSnapshot(value));
 assert.equal(pollOptions({windowsVoiceState:true,experimentalK1Lamp:true}).windowsVoiceState,true);
 assert.throws(()=>pollOptions({windowsVoiceState:1}));
});
