import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store,atomicJSON} from '../electron/store.mjs';
import {createStreamBuffer} from '../src/stream-buffer.mjs';

async function fixture(run){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'archi-index-'));
  try{const store=new Store(path.join(root,'profile'),{});await store.init('en');const project=await store.addProject(path.join(root,'project'));await run({root,store,project});}
  finally{await fs.rm(root,{recursive:true,force:true});}
}
test('session index survives restart and detects external changes, new files and removals',async()=>fixture(async({store,project})=>{
  const session=await store.newSession(project.id);session.title='Original';session.messages=[{id:'a',text:'Saved'}];await store.saveSession(session);
  assert.equal((await store.sessions(project.id))[0].count,1);
  const reopened=new Store(store.directory,{});await reopened.init('en');
  assert.equal((await reopened.sessions(project.id))[0].title,'Original');
  session.title='External';session.messages.push({id:'b',text:'Changed'});await atomicJSON(store.sessionFile(project.id,session.id),session);
  assert.equal((await reopened.sessions(project.id))[0].title,'External');assert.equal((await reopened.sessions(project.id))[0].count,2);
  await fs.unlink(store.sessionFile(project.id,session.id));assert.deepEqual(await reopened.sessions(project.id),[]);
}));
test('corrupt index is rebuilt while corrupt canonical data remains an error',async()=>fixture(async({store,project})=>{
  const session=await store.newSession(project.id);await fs.writeFile(path.join(store.projectStorage(project.id),'session-index.json'),'broken');
  const reopened=new Store(store.directory,{});await reopened.init('en');assert.equal((await reopened.sessions(project.id))[0].id,session.id);
  await fs.writeFile(store.sessionFile(project.id,session.id),'broken');await assert.rejects(reopened.sessions(project.id),/Cannot read/);
}));
test('index changes follow concurrent writes, archives, draft moves and deletion',async()=>fixture(async({root,store,project})=>{
  const other=await store.addProject(path.join(root,'other')),sessions=await Promise.all(Array.from({length:8},()=>store.newSession(project.id)));
  await Promise.all(sessions.map(async(s,i)=>{s.title=`Saved ${i}`;await store.saveSession(s);}));
  assert.equal((await store.sessions(project.id)).length,8);
  await store.archiveSession(project.id,sessions[0].id,true);assert((await store.sessions(project.id)).find(s=>s.id===sessions[0].id).archivedAt);
  const moved=await store.moveDraft(project.id,sessions[1].id,other.id);assert.equal(moved.projectId,other.id);
  assert.equal((await store.sessions(project.id)).length,7);assert.equal((await store.sessions(other.id)).length,1);
  await store.deleteSession(other.id,moved.id);assert.deepEqual(await store.sessions(other.id),[]);
}));
test('unchanged indexed sessions do not read full conversation JSON',async()=>fixture(async({store,project})=>{
  const session=await store.newSession(project.id);await store.sessions(project.id);
  const original=fs.readFile;let fullReads=0;
  fs.readFile=async(file,...args)=>{if(String(file)===store.sessionFile(project.id,session.id))fullReads++;return original.call(fs,file,...args);};
  try{await store.sessions(project.id);assert.equal(fullReads,0);}finally{fs.readFile=original;}
}));
test('stream bursts coalesce per frame without losing interleaved fragments',()=>{
  const jobs=new Map(),published=[];let id=0;
  const buffer=createStreamBuffer({publish:batch=>published.push(batch),schedule:fn=>{jobs.set(++id,fn);return id;},cancel:key=>jobs.delete(key)});
  buffer.append('a','one');buffer.append('b','two');buffer.append('a','three');assert.equal(jobs.size,1);
  [...jobs.values()][0]();jobs.clear();assert.deepEqual(published,[{a:'onethree',b:'two'}]);
  buffer.append('a','discard');buffer.remove('a');assert.equal(jobs.size,0);
  buffer.append('a','old chat');buffer.reset();assert.equal(jobs.size,0);
  buffer.append('b','unmounted');buffer.dispose();buffer.append('b','late');assert.equal(jobs.size,0);assert.equal(published.length,1);
});
