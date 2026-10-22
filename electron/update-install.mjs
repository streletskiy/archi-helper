import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {translate} from '../locales/index.mjs';

// Keep the update screen alive outside the installation directory so Windows
// can replace the application. The native helper uses the Windows .NET runtime.
export async function stageUpdateHelper({app,win,update,language,executable=process.execPath,helperSource}) {
  helperSource??=app.isPackaged?path.join(path.dirname(executable),'resources','update-helper.exe'):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.cache/update-helper/update-helper.exe');
  const keys={preparingTitle:'ui.updatePreparingTitle',preparingDescription:'ui.updatePreparingDescription',applyingTitle:'ui.installingUpdate',applyingDescription:'ui.updateInstallDescription',restartingTitle:'ui.updateRestartingTitle',restartingDescription:'ui.updateRestartingDescription',reopeningTitle:'ui.reopenApplication',reopeningDescription:'ui.updateReopeningDescription',errorTitle:'ui.updateFailed',errorDescription:'ui.updateInstallFailedDescription',reopen:'ui.reopenApplication',install:'ui.updateInstallStage',launch:'ui.updateLaunchStage'};
  const labels=Object.fromEntries(Object.entries(keys).map(([key,value])=>[key,translate(language,value)]));
  const root=await fs.mkdtemp(path.join(app.getPath('temp'),'archi-update-'));
  const helperExe=path.join(root,'Archi Helper Update.exe'),statusFile=path.join(root,'install-status.txt');
  try{
  await Promise.all([
    fs.copyFile(helperSource,helperExe),
    fs.writeFile(path.join(root,'config.json'),JSON.stringify({name:'archi-update-helper',protocol:2,root,statusFile,executable,language,labels,update,bounds:win.getBounds(),maximized:win.isMaximized(),args:process.argv.filter(arg=>arg.startsWith('--archi-data-dir='))}))
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
  const child=spawn(helperExe,[],{cwd:root,detached:true,env,stdio:'ignore'});
  try{await new Promise((resolve,reject)=>{
    let settled=false,reading=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timeout);clearInterval(timer);child.removeListener('error',failed);child.removeListener('exit',exited);if(error)reject(error);else resolve();};
    const failed=error=>finish(error),exited=()=>failed(new Error('Update screen closed before it was ready'));
    const timeout=setTimeout(()=>failed(new Error('Update screen did not start')),30000);
    const timer=setInterval(async()=>{if(reading||settled)return;reading=true;try{const ready=await fs.readFile(path.join(root,'helper-ready.json'),'utf8').then(JSON.parse).catch(()=>null);if(ready?.protocol===2&&ready.pid===child.pid)finish();}finally{reading=false;}},50);
    child.once('error',failed);
    child.once('exit',exited);
  });}catch(error){
    child.kill();
    await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:500}).catch(()=>{});
    throw error;
  }
  child.unref();
  return {child,statusFile,abort:()=>fs.writeFile(path.join(root,'abort'),'1').catch(()=>{child.kill();})};
}

export async function installUpdate(options) {
  const {child,statusFile,abort}=await prepareUpdateHelper(options);
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
  const manifest=await fs.readFile(path.join(resolved,'config.json'),'utf8').then(JSON.parse).catch(()=>null);
  const legacy=await fs.readFile(path.join(resolved,'resources','app','package.json'),'utf8').then(JSON.parse).catch(()=>null);
  const native=manifest?.name==='archi-update-helper'&&manifest.protocol===2&&path.resolve(manifest.root||'')===resolved;
  if(!native&&legacy?.name!=='archi-update-helper')return;
  // Also acknowledge a launch performed by NSIS, without a Node IPC channel.
  await fs.writeFile(path.join(resolved,'app-ready.json'),JSON.stringify({version:app.getVersion(),pid:process.pid}));
  if(handoff?.root===resolved)await fs.rm(handoffFile,{force:true});
  try{
    // Preserve the readiness file until the helper has exited and Windows has
    // released its executable. Removing the directory first races the reader.
    await fs.rm(path.join(resolved,'Archi Helper Update.exe'),{force:true,maxRetries:15,retryDelay:1000});
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:15,retryDelay:1000});
  }catch{}
}
