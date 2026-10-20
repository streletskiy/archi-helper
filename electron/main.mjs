import { t } from '../locales/index.mjs';
import { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, projectPath, imageFile } from './store.mjs';
import { models } from './provider.mjs';
import { MCP } from './mcp.mjs';
import { Agent } from './agent.mjs';
import updaterModule from 'electron-updater';
import { createUpdates } from './updates.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const dataOverride=process.env.ARCHI_DATA_DIR || process.argv.find(a=>a.startsWith('--archi-data-dir='))?.slice('--archi-data-dir='.length);
if(dataOverride)app.setPath('userData',path.resolve(dataOverride));
// Keep the original profile so renaming the application preserves keys and projects.
else if(app.isPackaged)app.setPath('userData',path.join(app.getPath('appData'),'Archi'));
let win,store,mcp,agent,updates,connection={connected:false,message:t('ui.connectingAlt')},connecting,activeCalls=0;
const runtime=app.isPackaged?path.join(process.resourcesPath,'runtime'):path.resolve(here,'../runtime');
const emit=data=>{if(win && !win.isDestroyed())win.webContents.send('archi:event',data);};
const publicState=()=>({...store.publicState(),connection,runtimeReady:!!mcp.python,toolCount:mcp.tools.length,busy:!!agent.running,activeSession:agent.activeSession,update:updates?.state});
async function connect() {
  if(connecting)return connecting;
  connecting=(async()=>{
    try {
      if(agent.running)throw new Error(t('errors.cannotChangeTheConnectionDuringATask'));
      await mcp.connect(store.state.archicadPort);
      const result=await mcp.call('TestConnection',{});
      const data=result.structuredContent || parseResult(result);
      connection={connected:!result.isError,message:result.isError?String(data):t('errors.archicadConnected'),data,port:store.state.archicadPort};
      if(!result.isError) {
        const info=await mcp.call('GetProjectInfo',{});
        connection.project=info.structuredContent || parseResult(info);
      }
    } catch(e) {connection={connected:false,message:e.message};}
    emit({type:'connection',connection,toolCount:mcp.tools.length,runtimeReady:!!mcp.python});
    return connection;
  })().finally(()=>{connecting=null;});
  return connecting;
}
function parseResult(result) {
  const text=result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n') || '';
  try{return JSON.parse(text);}catch{return text;}
}
async function attachFiles(projectId) {
  const chosen=await dialog.showOpenDialog(win,{title:t('errors.addProjectMaterials'),properties:['openFile','multiSelections']});
  if(chosen.canceled)return [];
  const result=[],root=store.project(projectId).path;
  for(const file of chosen.filePaths) {
    const name=path.basename(file),relative=`Materials/${Date.now()}-${name}`,destination=await projectPath(root,relative);
    await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(file,destination);result.push(relative);
  }
  return result;
}
async function scan() {
  return (await Promise.all(Array.from({length:21},(_,i)=>i+19723).map(async port=>{
    try{
      const r=await fetch(`http://127.0.0.1:${port}`,{method:'POST',body:JSON.stringify({command:'API.GetProductInfo',parameters:{}}),headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(1000)});
      const data=await r.json();if(data.succeeded)return {port,...data.result};
    }catch{}return null;
  }))).filter(Boolean);
}
async function installTapir(version) {
  if(!Number.isInteger(Number(version)) || Number(version)<25 || Number(version)>30)throw new Error(t('errors.chooseArchicad2530'));
  const response=await fetch('https://api.github.com/repos/ENZYME-APD/tapir-archicad-automation/releases/latest',{headers:{'User-Agent':'Archi/0.1'},signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`GitHub HTTP ${response.status}`);
  const release=await response.json(),name=`TapirAddOn_AC${version}_Win.apx`,asset=release.assets.find(a=>a.name===name);
  if(!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw new Error(t('errors.thisReleaseHasNoVerifiableFileFor'));
  const url=new URL(asset.browser_download_url);
  if(url.hostname!=='github.com' || !url.pathname.startsWith('/ENZYME-APD/tapir-archicad-automation/releases/download/'))throw new Error(t('errors.unexpectedReleaseUrl'));
  const dataResponse=await fetch(url,{signal:AbortSignal.timeout(120000)});
  if(!dataResponse.ok)throw new Error(t('errors.tapirDownloadHttp',{value0:dataResponse.status}));
  const bytes=Buffer.from(await dataResponse.arrayBuffer());
  const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  if(`sha256:${digest}`!==asset.digest)throw new Error(t('errors.tapirChecksumMismatch'));
  const folder=path.join(app.getPath('userData'),'addons',`AC${version}`,release.tag_name);
  await fs.mkdir(folder,{recursive:true});const file=path.join(folder,name);await fs.writeFile(file,bytes);
  const target=path.join(process.env.ProgramFiles||'C:\\Program Files','Graphisoft',`Archicad ${version}`,'Add-Ons','Archi',name);
  let installed=false;
  try {
    // A loaded add-on must be updated only after Archicad closes.
    if((await scan()).some(x=>Number(x.version)===Number(version)))throw new Error(t('errors.archicadIsOpen'));
    await fs.access(path.dirname(path.dirname(target)));
    await fs.mkdir(path.dirname(target),{recursive:true});
    try {await fs.access(target);await fs.copyFile(target,`${target}.${Date.now()}.bak`);}catch{}
    await fs.copyFile(file,target);installed=true;
  }catch{}
  shell.showItemInFolder(installed?target:file);
  return {version:release.tag_name,file:installed?target:file,installed,sha256:digest,message:installed?t('errors.tapirInstalledRestartArchicad'):t('errors.tapirDownloadedAndVerifiedInArchicadOpen')};
}
const handlers={
  bootstrap:async()=>publicState(),
  updateIdle:async({idle})=>updates.setIdle(idle),
  checkUpdates:async()=>updates.check(),
  deferUpdate:async()=>updates.defer(),
  createProject:async({name,existing=false})=>{
    const chosen=await dialog.showOpenDialog(win,{title:existing?t('errors.chooseProjectFolder'):t('errors.whereShouldTheProjectFolderBeCreated'),properties:['openDirectory','createDirectory']});
    if(chosen.canceled)return null;
    if(!existing && (!name?.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)))throw new Error(t('errors.enterAValidWindowsFolderName'));
    const directory=existing?chosen.filePaths[0]:path.join(chosen.filePaths[0],name.trim());
    return store.addProject(directory,existing?undefined:name);
  },
  sessions:async({projectId})=>store.sessions(projectId),
  session:async({projectId,id})=>{
    const s=await store.session(projectId,id);
    if(!agent.running && s.messages.some(m=>m.status==='running')){
      for(const m of s.messages)if(m.status==='running'){m.status='error';m.text=t('errors.theAppClosedDuringAnOperationThe');}
      agent.repair(s.history);await store.saveSession(s);
    }
    return {...s,history:undefined};
  },
  newSession:async({projectId})=>store.newSession(projectId),
  renameSession:async({projectId,id,title})=>{const s=await store.session(projectId,id);s.title=String(title).slice(0,100);await store.saveSession(s);return s.title;},
  saveProvider:async input=>{await store.provider(input);return publicState();},
  deleteProvider:async({id})=>{store.state.providers=store.state.providers.filter(p=>p.id!==id);if(store.state.providerId===id){store.state.providerId=store.state.providers[0]?.id||'';store.state.model='';}await store.save();return publicState();},
  models:async({id})=>{
    const p=store.getProvider(id),list=await models(p);
    store.state.providers.find(p=>p.id===id).models=list;await store.save();return list;
  },
  settings:async input=>{
    if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));
    if(input.language!==undefined)await store.setLanguage(input.language);
    if(input.providerId!==undefined)store.state.providerId=String(input.providerId);
    if(input.model!==undefined)store.state.model=String(input.model);
    if(input.permissionMode!==undefined) {
      if(!['review','read','full'].includes(input.permissionMode))throw new Error(t('errors.unknownWorkMode'));
      store.state.permissionMode=input.permissionMode;
    }
    if(input.archicadPort!==undefined) {
      const p=String(input.archicadPort);if(p && (!/^\d+$/.test(p)||Number(p)<19723||Number(p)>19743))throw new Error(t('errors.portMustBeBetween19723And19743'));store.state.archicadPort=p;
    }
    await store.save();return publicState();
  },
  connect:async()=>connect(),
  scan:async()=>scan(),
  tools:async()=>mcp.tools.map(t=>({key:t.key,name:t.name,description:t.description,inputSchema:t.inputSchema,readOnly:t.annotations?.readOnlyHint===true})),
  directTool:async({projectId,sessionId,key,args,mode})=>{
    if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));
    const s=await store.session(projectId,sessionId),controller=new AbortController();
    agent.running=controller;agent.activeSession=sessionId;emit({type:'busy',busy:true,sessionId});
    const m={id:crypto.randomUUID(),role:'tool',name:key,args,text:'',status:'running',at:Date.now()};
    s.messages.push(m);await store.saveSession(s);emit({type:'message',message:m,sessionId});
    try {
      let result;
      try {result=await agent.execute(s,'call_archicad',{name:key,arguments:args},mode,controller.signal);}
      catch(error){result={isError:true,error:error.message};}
      const artifact=await store.artifact(projectId,sessionId,key,result);
      Object.assign(m,{text:JSON.stringify(result).slice(0,24000),status:result.isError?'error':'done',artifact});
      await store.saveSession(s);emit({type:'message',message:m,sessionId});return m;
    }finally{agent.running=null;agent.activeSession=null;emit({type:'busy',busy:false,sessionId});}
  },
  send:async input=>{if(agent.running)throw new Error(t('errors.aTaskIsAlreadyRunning'));if(!input.text?.trim())throw new Error(t('errors.enterATask'));await agent.run(input);return true;},
  stop:async()=>{agent.stop();return true;},
  approve:async({id,allowed})=>{agent.approve(id,allowed===true);return true;},
  attach:async({projectId})=>attachFiles(projectId),
  image:async({projectId,relative})=>{
    const {mime,data}=await imageFile(store.project(projectId).path,decodeURIComponent(relative));
    return `data:${mime};base64,${data.toString('base64')}`;
  },
  reveal:async({projectId,relative})=>{
    const root=store.project(projectId).path;
    if(!relative){await shell.openPath(root);return true;}
    const file=await projectPath(root,relative);await fs.access(file);shell.showItemInFolder(file);return true;
  },
  exportSession:async({projectId,id})=>{
    const s=await store.session(projectId,id),root=store.project(projectId).path;
    const relative=t('errors.reportMd',{value0:new Date().toISOString().slice(0,10),value1:id.slice(0,8)}),file=await projectPath(root,relative);
    await fs.writeFile(file,`# ${s.title}\n\n`+s.messages.map(m=>`## ${m.role==='user'?t('ui.you'):m.role==='assistant'?'Archi Helper':m.name||t('errors.system')}\n\n${m.text}\n${m.artifact?t('errors.fullResult',{value0:m.artifact.path}):''}`).join('\n\n'),'utf8');shell.showItemInFolder(file);return relative;
  },
  installTapir:async({version})=>installTapir(version),
  launchArchicad:async()=>{
    const chosen=await dialog.showOpenDialog(win,{title:t('errors.openProjectInArchicad'),filters:[{name:t('errors.archicadProject'),extensions:['pln','pla','tpl']}],properties:['openFile']});
    if(chosen.canceled)return false;const error=await shell.openPath(chosen.filePaths[0]);if(error)throw new Error(error);return true;
  },
  external:async({url})=>{const u=new URL(url);if(u.protocol!=='https:')throw new Error(t('errors.onlyHttpsLinksAreAllowed'));await shell.openExternal(u.toString());},
  window:async({action})=>{if(action==='minimize')win.minimize();else if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();else if(action==='close')win.close();}
};
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(async()=>{
  app.setAppUserModelId('app.ac-helper.archi');
  Menu.setApplicationMenu(null);
  store=new Store(app.getPath('userData'),{
    encrypt:value=>{if(!safeStorage.isEncryptionAvailable())throw new Error(t('errors.windowsEncryptionIsUnavailable'));return safeStorage.encryptString(value).toString('base64');},
    decrypt:value=>safeStorage.decryptString(Buffer.from(value,'base64'))
  });
  await store.init(app.getLocale());connection={connected:false,message:t('ui.connectingAlt')};mcp=new MCP(runtime);agent=new Agent(store,mcp,emit);
  updates=createUpdates({updater:updaterModule.autoUpdater,enabled:app.isPackaged&&process.platform==='win32'&&!process.env.PORTABLE_EXECUTABLE_FILE,version:app.getVersion(),getBusy:()=>!!agent.running||activeCalls>0,emit,install:()=>updaterModule.autoUpdater.quitAndInstall(true,true)});
  ipcMain.handle('archi:call',async(event,method,input={})=>{
    if(event.sender!==win?.webContents || event.senderFrame!==win.webContents.mainFrame)throw new Error(t('errors.untrustedRequest'));
    if(updates.state.status==='installing'&&!['bootstrap','window'].includes(method))throw new Error(t('errors.anUpdateIsBeingInstalled'));
    if(!Object.hasOwn(handlers,method))throw new Error(t('errors.unknownOperation'));
    const tracked=!['bootstrap','updateIdle','checkUpdates','deferUpdate','window'].includes(method);
    if(tracked){activeCalls++;updates.workChanged();}
    try{return {ok:true,value:await handlers[method](input)};}
    catch(e){return {ok:false,error:e.message};}
    finally{if(tracked){activeCalls--;updates.workChanged();}}
  });
  win=new BrowserWindow({width:1440,height:950,minWidth:1000,minHeight:680,show:false,backgroundColor:'#f7f7f2',frame:false,title:'Archi Helper',icon:path.resolve(here,'../dist/icon.png'),webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event)=>event.preventDefault());
  if(!app.isPackaged && process.env.ARCHI_DEV_URL)await win.loadURL(process.env.ARCHI_DEV_URL);else await win.loadFile(path.resolve(here,'../dist/index.html'));
  win.show();connect();
  const updateTimer=setTimeout(()=>updates.check(),15000);updateTimer.unref();
  win.on('close',event=>{
    if(agent.running){event.preventDefault();dialog.showMessageBox(win,{type:'question',message:t('errors.stopTheTaskAndCloseArchiHelper'),detail:t('errors.changesAlreadyMadeInArchicadWillNot'),buttons:[t('errors.keepWorking'),t('errors.stopAndClose')],defaultId:0,cancelId:0}).then(({response})=>{if(response===1){agent.stop();setTimeout(()=>win.destroy(),500);}});}
  });
  app.on('window-all-closed',()=>app.quit());
  let quitting=false;app.on('before-quit',event=>{if(!quitting){event.preventDefault();quitting=true;clearTimeout(updateTimer);updates.dispose();agent.stop();mcp.close().finally(()=>app.quit());}});
  }).catch(error=>{dialog.showErrorBox(t('errors.archiHelperStartupError'),error.message);app.quit();});
}
