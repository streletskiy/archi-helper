import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createUpdates} from '../electron/updates.mjs';

function setup(enabled=true,install){
  const updater=new EventEmitter(),pending=new Map();
  let busy=false,installed=0,checks=0,id=0;
  updater.checkForUpdates=async()=>{checks++;updater.emit('update-not-available');};
  const updates=createUpdates({updater,enabled,version:'0.1.0',getBusy:()=>busy,emit:()=>{},install:install||(()=>installed++),
    schedule:(fn,ms)=>{pending.set(++id,{fn,ms});return id;},cancel:key=>pending.delete(key)});
  return {updater,updates,pending,setBusy:value=>{busy=value;},get installed(){return installed;},get checks(){return checks;},
    tick(){const jobs=[...pending.values()];pending.clear();return Promise.all(jobs.map(({fn})=>fn()));}};
}

test('download finishes during a task; restart waits for a safe editor',()=>{
  const t=setup();t.setBusy(true);t.updates.setIdle(false);
  t.updater.emit('update-downloaded',{version:'0.2.0'});t.tick();
  assert.equal(t.installed,0);
  t.setBusy(false);t.updates.setIdle(true);
  assert.equal(t.updates.state.status,'countdown');
  t.updates.setIdle(false);t.tick();assert.equal(t.installed,0);
  t.updates.setIdle(true);t.tick();assert.equal(t.updates.state.status,'installing');
  t.updates.workChanged();t.tick();assert.equal(t.installed,1);
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
  t.tick();
  assert.equal(t.installed,1);
});
test('portable/development builds never check or install',async()=>{
  const t=setup(false);await t.updates.start();await t.updates.check();t.updates.setIdle(true);t.tick();
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

test('startup checks immediately, starts once and checks again hourly',async()=>{
  const t=setup();
  await t.updates.start();await t.updates.start();
  assert.equal(t.checks,1);
  assert.equal(t.updates.state.status,'current');
  assert.deepEqual([...t.pending.values()].map(job=>job.ms),[3600000]);
  await t.tick();assert.equal(t.checks,2);
  t.updates.dispose();assert.equal(t.pending.size,0);
});

test('startup network failure retries automatically after a minute',async()=>{
  const t=setup();let attempts=0;
  t.updater.checkForUpdates=async()=>{
    t.updater.emit('checking-for-update');
    if(++attempts===1)throw Error('offline');
    t.updater.emit('update-not-available');
  };
  await t.updates.start();
  assert.equal(t.updates.state.status,'error');
  assert.deepEqual([...t.pending.values()].map(job=>job.ms),[60000]);
  await t.tick();assert.equal(attempts,2);assert.equal(t.updates.state.status,'current');
});

test('automatic download exposes progress and finishes before another check can start',async()=>{
  const t=setup();let complete,checks=0;
  const downloadPromise=new Promise(resolve=>{complete=resolve;});
  t.updater.checkForUpdates=()=>{
    checks++;t.updater.emit('checking-for-update');
    t.updater.emit('update-available',{version:'0.2.0'});
    return {downloadPromise};
  };
  const started=t.updates.start();await Promise.resolve();
  const concurrent=t.updates.check();
  t.updater.emit('download-progress',{percent:42.4,transferred:424,total:1000,bytesPerSecond:100});
  assert.equal(t.updates.state.percent,42);
  assert.equal(t.updates.state.transferred,424);
  assert.equal(t.updates.state.total,1000);
  assert.equal(t.updates.state.bytesPerSecond,100);
  assert.equal(t.pending.size,0);
  t.updater.emit('update-downloaded',{version:'0.2.0'});complete();
  await Promise.all([started,concurrent]);
  assert.equal(checks,1);assert.equal(t.updates.state.status,'ready');
  assert.equal(t.pending.size,0);
  t.updates.setIdle(true);
  assert.deepEqual([...t.pending.values()].map(job=>job.ms),[10000]);
  await t.tick();assert.equal(t.updates.state.status,'installing');assert.equal(t.installed,0);
  assert.deepEqual([...t.pending.values()].map(job=>job.ms),[500]);
  await t.tick();assert.equal(t.installed,1);
});

test('automatic download rejection is handled and retried without a manual check',async()=>{
  const t=setup();
  t.updater.checkForUpdates=()=>{
    t.updater.emit('update-available',{version:'0.2.0'});
    return {downloadPromise:Promise.reject(Error('download interrupted'))};
  };
  await t.updates.start();
  assert.equal(t.updates.state.status,'error');
  assert.deepEqual([...t.pending.values()].map(job=>job.ms),[60000]);
  t.updater.checkForUpdates=async()=>{t.updater.emit('update-not-available');};
  await t.tick();assert.equal(t.updates.state.status,'current');
});

test('closing during a check or installation stops all scheduled work',async()=>{
  const t=setup();let finish;
  t.updater.checkForUpdates=()=>new Promise(resolve=>{finish=resolve;});
  const checking=t.updates.start();await Promise.resolve();
  t.updates.dispose();finish({});await checking;
  await t.updates.check();await t.updates.start();
  t.updater.emit('update-downloaded',{version:'0.2.0'});t.updates.setIdle(true);
  assert.equal(t.pending.size,0);
  const installing=setup();installing.updates.setIdle(true);
  installing.updater.emit('update-downloaded',{version:'0.2.0'});
  await installing.tick();installing.updates.dispose();await installing.tick();
  assert.equal(installing.installed,0);
});

test('failed asynchronous installation preparation leaves a retryable error',async()=>{
  const t=setup(true,()=>Promise.reject(Error('not enough disk space')));
  await t.updates.start();t.updates.setIdle(true);
  t.updater.emit('update-downloaded',{version:'0.2.0'});
  await t.tick();await t.tick();
  assert.equal(t.updates.state.status,'error');
  assert.deepEqual([...t.pending.values()].map(job=>job.ms),[60000]);
});
