import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stageUpdateHelper,cleanupUpdateHelper} from '../electron/update-install.mjs';

async function fixture(run){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'archi-handoff-test-'));
  const app={isPackaged:false,getPath:name=>name==='temp'?temp:path.join(temp,'profile'),getVersion:()=> '0.2.10'};
  await fs.mkdir(app.getPath('userData'));
  try{await run({app,temp});}finally{await fs.rm(temp,{recursive:true,force:true});}
}
test('native helper stages only its executable and localized handoff configuration',async()=>fixture(async({app,temp})=>{
  const source=path.join(temp,'helper.exe');await fs.writeFile(source,'MZ-test');
  const staged=await stageUpdateHelper({app,helperSource:source,executable:path.join(temp,'Archi Helper.exe'),win:{getBounds:()=>({x:20,y:30,width:1200,height:800}),isMaximized:()=>false},update:{version:'0.2.9',nextVersion:'0.2.10'},language:'ru'});
  assert.deepEqual((await fs.readdir(staged.root)).sort(),['Archi Helper Update.exe','config.json']);
  const config=JSON.parse(await fs.readFile(path.join(staged.root,'config.json'),'utf8'));
  assert.equal(config.name,'archi-update-helper');assert.equal(config.protocol,2);assert.equal(config.root,staged.root);
  assert.equal(config.statusFile,staged.statusFile);assert.match(config.labels.preparingTitle,/[\u0400-\u04ff]/);assert.equal(config.bounds.width,1200);
  const before=(await fs.readdir(temp)).sort();
  await assert.rejects(stageUpdateHelper({app,helperSource:path.join(temp,'missing.exe'),win:{getBounds:()=>({}),isMaximized:()=>false},update:{},language:'en'}));
  assert.deepEqual((await fs.readdir(temp)).sort(),before,'Failed staging left a temporary copy');
}));
test('new application cleans both native and 0.2.9 helper handoffs',async()=>fixture(async({app,temp})=>{
  for(const legacy of [false,true]){
    const root=await fs.mkdtemp(path.join(temp,'archi-update-'));
    if(legacy){const dir=path.join(root,'resources','app');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:'archi-update-helper'}));}
    else await fs.writeFile(path.join(root,'config.json'),JSON.stringify({name:'archi-update-helper',protocol:2,root}));
    await fs.writeFile(path.join(root,'Archi Helper Update.exe'),'MZ-test');
    const handoff=path.join(app.getPath('userData'),'update-handoff.json');await fs.writeFile(handoff,JSON.stringify({root,version:'0.2.10'}));
    await cleanupUpdateHelper(app);await assert.rejects(fs.stat(root),{code:'ENOENT'});await assert.rejects(fs.stat(handoff),{code:'ENOENT'});
  }
}));
test('handoff cleanup ignores directories outside its marked temporary area',async()=>fixture(async({app,temp})=>{
  const root=path.join(temp,'keep-profile');await fs.mkdir(root);await fs.writeFile(path.join(root,'config.json'),JSON.stringify({name:'archi-update-helper',protocol:2,root}));
  await fs.writeFile(path.join(app.getPath('userData'),'update-handoff.json'),JSON.stringify({root,version:'0.2.10'}));
  await cleanupUpdateHelper(app);assert((await fs.stat(root)).isDirectory());
}));
