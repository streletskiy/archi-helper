import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createUpdates} from '../electron/updates.mjs';

function setup(enabled=true){
  const updater=new EventEmitter(),pending=new Map();
  let busy=false,installed=0,checks=0,id=0;
  updater.checkForUpdates=async()=>{checks++;updater.emit('update-not-available');};
  const updates=createUpdates({updater,enabled,version:'0.1.0',getBusy:()=>busy,emit:()=>{},install:()=>installed++,
    schedule:fn=>{pending.set(++id,fn);return id;},cancel:key=>pending.delete(key)});
  return {updater,updates,pending,setBusy:value=>{busy=value;},get installed(){return installed;},get checks(){return checks;},
    tick(){const jobs=[...pending.values()];pending.clear();jobs.forEach(fn=>fn());}};
}

test('download finishes during a task; restart waits for a safe editor',()=>{
  const t=setup();t.setBusy(true);t.updates.setIdle(false);
  t.updater.emit('update-downloaded',{version:'0.2.0'});t.tick();
  assert.equal(t.installed,0);
  t.setBusy(false);t.updates.setIdle(true);
  assert.equal(t.updates.state.status,'countdown');
  t.updates.setIdle(false);t.tick();assert.equal(t.installed,0);
  t.updates.setIdle(true);t.tick();assert.equal(t.installed,1);
});
test('a task starting during countdown is checked again before installation',()=>{
  const t=setup();t.updates.setIdle(true);t.updater.emit('update-downloaded',{version:'0.2.0'});
  t.setBusy(true);t.tick();assert.equal(t.installed,0);
});
test('defer lasts until the next launch',()=>{
  const t=setup();t.updates.setIdle(true);t.updater.emit('update-downloaded',{version:'0.2.0'});
  t.updates.defer();t.updates.setIdle(false);t.updates.setIdle(true);t.tick();
  assert.equal(t.installed,0);assert.equal(t.updates.state.status,'ready');
});
test('a native file dialog or file operation delays restart even with an empty editor',()=>{
  const t=setup();t.updates.setIdle(true);t.setBusy(true);
  t.updater.emit('update-downloaded',{version:'0.2.0'});t.tick();
  assert.equal(t.installed,0);
  t.setBusy(false);t.updates.workChanged();t.tick();
  assert.equal(t.installed,1);
});
test('portable/development builds never check or install',async()=>{
  const t=setup(false);await t.updates.check();t.updates.setIdle(true);t.tick();
  assert.equal(t.checks,0);assert.equal(t.installed,0);assert.equal(t.updates.state.status,'disabled');
});
test('network failure permits retry and concurrent checks are deduplicated',async()=>{
  const t=setup();t.updater.checkForUpdates=async()=>{throw Error('offline');};
  await t.updates.check();assert.equal(t.updates.state.status,'error');
  let checks=0;
  t.updater.checkForUpdates=async()=>{checks++;t.updater.emit('update-not-available');return {};};
  const results=await Promise.all([t.updates.check(),t.updates.check()]);
  assert.equal(checks,1);
  assert.ok(results.every(result=>result.status==='current'));
  assert.equal(t.updates.state.status,'current');
  assert.equal(t.updater.autoInstallOnAppQuit,false);
  assert.equal(t.updater.allowPrerelease,false);
  assert.equal(t.updater.allowDowngrade,false);
});
