import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

async function copyTree(source,target){
  await fs.mkdir(target,{recursive:true});
  const entries=await fs.readdir(source,{withFileTypes:true});
  await Promise.all(entries.map(entry=>entry.isDirectory()
    ?copyTree(path.join(source,entry.name),path.join(target,entry.name))
    :fs.copyFile(path.join(source,entry.name),path.join(target,entry.name))));
}

// Keep the update screen alive outside the installation directory so Windows
// can replace the application. The temporary runtime does not include Python.
export async function stageUpdateHelper({app,win,update,language,executable=process.execPath}) {
  const root=await fs.mkdtemp(path.join(app.getPath('temp'),'archi-update-'));
  const runtime=path.dirname(executable),helperApp=path.join(root,'resources','app');
  const helperExe=path.join(root,'Archi Helper Update.exe'),statusFile=path.join(root,'install-status.txt');
  await fs.mkdir(helperApp,{recursive:true});
  try{
  const entries=await fs.readdir(runtime,{withFileTypes:true});
  await Promise.all(entries.filter(entry=>entry.isFile()&&(entry.name===path.basename(executable)||/\.(dll|pak|bin|dat|json)$/i.test(entry.name))).map(entry=>
    fs.copyFile(path.join(runtime,entry.name),entry.name===path.basename(executable)?helperExe:path.join(root,entry.name))));
  await Promise.all([
    fs.cp(path.join(runtime,'locales'),path.join(root,'locales'),{recursive:true}),
    copyTree(path.join(app.getAppPath(),'dist'),path.join(helperApp,'ui')),
    fs.copyFile(path.join(app.getAppPath(),'electron','update-helper.mjs'),path.join(helperApp,'main.mjs')),
    fs.copyFile(path.join(app.getAppPath(),'electron','preload.cjs'),path.join(helperApp,'preload.cjs')),
    fs.writeFile(path.join(helperApp,'package.json'),JSON.stringify({name:'archi-update-helper',productName:'Archi Helper',version:app.getVersion(),type:'module',main:'main.mjs'})),
    fs.writeFile(path.join(helperApp,'config.json'),JSON.stringify({root,statusFile,executable,language,update,bounds:win.getBounds(),maximized:win.isMaximized(),args:process.argv.filter(arg=>arg.startsWith('--archi-data-dir='))}))
  ]);
  return {root,helperExe,statusFile};
  }catch(error){
    await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500}).catch(()=>{});
    throw error;
  }
}

export async function prepareUpdateHelper(options) {
  const {root,helperExe,statusFile}=await stageUpdateHelper(options);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(helperExe,[],{cwd:root,detached:true,env,stdio:['ignore','ignore','ignore','ipc']});
  try{await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Update screen did not start'));},30000);
    const failed=error=>{clearTimeout(timeout);reject(error);};
    child.once('error',failed);
    child.once('exit',()=>failed(new Error('Update screen closed before it was ready')));
    child.on('message',message=>{if(message?.type==='archi-update-ready'){clearTimeout(timeout);resolve();}});
  });}catch(error){
    child.kill();
    await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500}).catch(()=>{});
    throw error;
  }
  child.unref();child.channel?.unref();
  return {child,statusFile};
}

export async function installUpdate(options) {
  const {child,statusFile}=await prepareUpdateHelper(options);
  const abort=()=>{if(child.connected)child.send({type:'abort'});};
  options.updater.once('error',abort);
  child.once('exit',()=>options.updater.removeListener('error',abort));
  // Keep signature checks, installer launch and elevation in electron-updater.
  process.env.ARCHI_UPDATE_STATUS_FILE=statusFile;
  try{
    // Native installer launches may not inherit our IPC channel or environment.
    await fs.writeFile(path.join(options.app.getPath('userData'),'update-handoff.json'),JSON.stringify({root:path.dirname(statusFile),version:options.update.nextVersion}));
    options.updater.quitAndInstall(true,true);
  }catch(error){abort();throw error;}
}

export async function cleanupUpdateHelper(app) {
  const handoffFile=path.join(app.getPath('userData'),'update-handoff.json');
  const handoff=await fs.readFile(handoffFile,'utf8').then(JSON.parse).catch(()=>null);
  const directory=process.env.ARCHI_UPDATE_HELPER_DIR||(handoff?.version===app.getVersion()?handoff.root:null);
  delete process.env.ARCHI_UPDATE_HELPER_DIR;
  if(!directory)return;
  const resolved=path.resolve(directory),temp=path.resolve(app.getPath('temp'));
  if(path.dirname(resolved).toLowerCase()!==temp.toLowerCase()||!path.basename(resolved).startsWith('archi-update-'))return;
  const manifest=await fs.readFile(path.join(resolved,'resources','app','package.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(manifest?.name!=='archi-update-helper')return;
  // Also acknowledge a launch performed by NSIS, without a Node IPC channel.
  await fs.writeFile(path.join(resolved,'app-ready.json'),JSON.stringify({version:app.getVersion()}));
  if(handoff?.root===resolved)await fs.rm(handoffFile,{force:true});
  try{
    // Preserve the readiness file until the helper has exited and Windows has
    // released its executable. Removing the directory first races the reader.
    await fs.rm(path.join(resolved,'Archi Helper Update.exe'),{recursive:true,force:true,maxRetries:15,retryDelay:1000});
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:15,retryDelay:1000});
  }catch{}
}
