import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Store,atomicJSON} from '../electron/store.mjs';
const require=createRequire(import.meta.url),{_electron}=require('playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),base=path.join(root,'.cache','performance-0.2.10');
await fs.mkdir(base,{recursive:true});
let fixture=await fs.readFile(path.join(base,'fixture.json'),'utf8').then(JSON.parse).catch(()=>null);
if(!fixture){
 const store=new Store(path.join(base,'profile'),{});await store.init('en');await store.save();
 const project=await store.addProject(path.join(base,'synthetic-project'),'Performance fixture');await store.migrateProject(project.id);
 let longSession;let bytes=0;
 for(let i=0;i<200;i++){
  const id=crypto.randomUUID(),messages=Array.from({length:i===0?1000:300},(_,j)=>({id:`message-${i}-${j}`,role:j%2?'assistant':'user',text:`### Message ${j}\n\n${'A synthetic architecture note with dimensions, materials and quantities. '.repeat(7)}\n\n- Detail ${j}\n- Verify the drawing\n\n\`item_${j}\``,at:1700000000000+j}));
  const session={id,projectId:project.id,title:i===0?'Benchmark conversation':`Synthetic chat ${i}`,updatedAt:1700000000000+(i===0?1000:i),messages,history:messages.map(m=>({role:m.role,content:m.text}))};
  const file=store.sessionFile(project.id,id);await atomicJSON(file,session);bytes+=(await fs.stat(file)).size;if(i===0)longSession=id;
 }
 fixture={profile:store.directory,projectId:project.id,sessionId:longSession,sessions:200,longMessages:1000,jsonBytes:bytes};await atomicJSON(path.join(base,'fixture.json'),fixture);
}
const label=process.argv[2]||'before',mode=process.argv[3]||'all',result={label,fixture};
const profileStore=new Store(fixture.profile,{});await profileStore.init('en');
if(!profileStore.state.providers.length){profileStore.state.providers=[{id:'benchmark-provider',name:'Synthetic provider',baseURL:'http://127.0.0.1:9/v1',models:[{id:'benchmark',name:'Benchmark'}],supportsImages:false,catalogUpdatedAt:Date.now()}];profileStore.state.providerId='benchmark-provider';profileStore.state.model='benchmark';await profileStore.save();}
const median=v=>[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)];
if(mode!=='ui'){
 const store=new Store(fixture.profile,{});await store.init('en');
 let start=performance.now();await store.sessions(fixture.projectId);result.firstSessionListMs=performance.now()-start;
 const samples=[];for(let i=0;i<7;i++){global.gc?.();start=performance.now();const sessions=await store.sessions(fixture.projectId);if(sessions.length!==200)throw Error('Fixture sessions missing');samples.push(performance.now()-start);}
 result.sessionList={medianMs:median(samples),samplesMs:samples};
 await atomicJSON(path.join(base,`${label}-store.json`),result);
}
if(mode!=='store'){
 const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const start=performance.now(),app=await _electron.launch({executablePath:path.join(root,'release','win-unpacked','Archi Helper.exe'),args:['--archi-data-dir='+fixture.profile],env,timeout:60000});
 try{
  const page=await app.firstWindow();await page.locator('.session-open').filter({hasText:'Benchmark conversation'}).waitFor({timeout:60000});result.sidebarReadyMs=performance.now()-start;
  const dialogClose=page.getByRole('button',{name:'Close dialog',exact:true});if(await dialogClose.count())await dialogClose.click();
  const open=performance.now();await page.locator('.session-open').filter({hasText:'Benchmark conversation'}).click();await page.getByRole('heading',{name:'Message 999',exact:true}).waitFor({timeout:60000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  result.conversationOpenMs=performance.now()-open;result.renderedMessages=await page.locator('.message').count();result.domNodes=await page.locator('*').count();
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  await page.evaluate(()=>{window.__benchBatches=0;window.__benchObserver=new MutationObserver(()=>window.__benchBatches++);window.__benchObserver.observe(document.querySelector('.messages'),{subtree:true,childList:true,characterData:true});});
  const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));const before=await metrics();
  await app.evaluate(async({BrowserWindow},{sessionId})=>{const web=BrowserWindow.getAllWindows()[0].webContents;for(let i=0;i<300;i++){web.send('archi:event',{type:'delta',sessionId,id:'benchmark-stream',delta:'x'});await new Promise(resolve=>setTimeout(resolve,2));}},{sessionId:fixture.sessionId});
  await page.waitForFunction(()=>[...document.querySelectorAll('.messages .prose')].some(e=>e.textContent==='x'.repeat(300)),{timeout:60000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const after=await metrics();
  result.stream={events:300,domMutationBatches:await page.evaluate(()=>window.__benchBatches),taskDurationMs:(after.TaskDuration-before.TaskDuration)*1000,scriptDurationMs:(after.ScriptDuration-before.ScriptDuration)*1000};
  await page.evaluate(()=>window.__benchObserver.disconnect());
  await atomicJSON(path.join(base,`${label}-ui-partial.json`),result);
  result.helper=await app.evaluate(async({app,BrowserWindow},{entry})=>{
   const require=process.getBuiltinModule('module').createRequire(entry),{stageUpdateHelper}=require(entry),fs=require('node:fs/promises'),path=require('node:path');
   const samples=[],sizes=[];for(let i=0;i<3;i++){
    const start=performance.now(),staged=await stageUpdateHelper({app,win:BrowserWindow.getAllWindows()[0],update:{version:app.getVersion(),nextVersion:'0.2.10'},language:'en'});samples.push(performance.now()-start);
    let bytes=0;async function visit(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await visit(p);else bytes+=(await fs.stat(p)).size;}}await visit(staged.root);sizes.push(bytes);
    const temp=path.resolve(app.getPath('temp'));if(path.dirname(path.resolve(staged.root)).toLowerCase()!==temp.toLowerCase()||!path.basename(staged.root).startsWith('archi-update-'))throw Error('Unexpected helper cleanup path');await fs.rm(staged.root,{recursive:true,force:true});
   }return {samplesMs:samples,copiedBytes:sizes[0]};
  },{entry:path.join(root,'electron','update-install.mjs')});result.helper.medianMs=median(result.helper.samplesMs);
 }finally{await app.close();}
}
await atomicJSON(path.join(base,`${label}-${mode}.json`),result);console.log(JSON.stringify(result));
