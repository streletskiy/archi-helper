import { t } from '../locales/index.mjs';
import { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu, session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store, projectPath, INBOX_ID } from './store.mjs';
import { models } from './provider.mjs';
import { providerDefinitions } from './provider-definitions.mjs';
import { OAuthManager } from './oauth-manager.mjs';
import { appFetch, configureAppFetch } from './network.mjs';
import { EFFORTS } from './reasoning.mjs';
import { MCP } from './mcp.mjs';
import { Agent } from './agent.mjs';
import updaterModule from 'electron-updater';
import { createUpdates } from './updates.mjs';
import { installUpdate, cleanupUpdateHelper } from './update-install.mjs';
import { showAppWindow } from './window-visibility.mjs';
import { installTapir } from './tapir-installer.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const dataOverride=process.env.ARCHI_DATA_DIR || process.argv.find(a=>a.startsWith('--archi-data-dir='))?.slice('--archi-data-dir='.length);
if(dataOverride)app.setPath('userData',path.resolve(dataOverride));
// Keep the original profile so renaming the application preserves keys and projects.
else if(app.isPackaged)app.setPath('userData',path.join(app.getPath('appData'),'Archi'));
let win,store,mcp,agent,updates,connection={connected:false,message:t('ui.connectingAlt')},connecting,activeCalls=0,tapirProgress=null,tapirInstalling=false;
const runtime=app.isPackaged?path.join(process.resourcesPath,'runtime'):path.resolve(here,'../runtime');
const emit=data=>{if(win && !win.isDestroyed())win.webContents.send('archi:event',data);};
const reportTapirProgress=patch=>{tapirProgress={...tapirProgress,...patch};emit({type:'tapir-progress',progress:tapirProgress});};
let pendingProviderPrompt;
function showProviderPrompt(options) {
  if(pendingProviderPrompt)throw new Error(t('errors.oauthAlreadyConnecting'));
  return new Promise(resolve=>{
    pendingProviderPrompt={prompt:{...options,id:crypto.randomUUID()},resolve};
    emit({type:'provider-prompt',prompt:pendingProviderPrompt.prompt});
  });
}
function answerProviderPrompt({id,response}) {
  const pending=pendingProviderPrompt;
  if(!pending||pending.prompt.id!==id||!Number.isInteger(response)||response<0||response>=pending.prompt.buttons.length)throw new Error(t('errors.unknownOperation'));
  pendingProviderPrompt=undefined;emit({type:'provider-prompt',prompt:null});pending.resolve({response});
}
const runtimeManifest=await fs.readFile(path.join(runtime,'manifest.json'),'utf8').then(JSON.parse).catch(()=>({}));
const publicState=()=>({...store.publicState(),providerPrompt:pendingProviderPrompt?.prompt,appVersion:app.getVersion(),updateApplied:process.argv.includes('--updated'),runtimeInfo:{pythonVersion:typeof runtimeManifest.pythonVersion==='string'?runtimeManifest.pythonVersion:undefined},connection,runtimeReady:!!mcp.python,toolCount:mcp.tools.length,busy:!!agent.running,activeSession:agent.activeSession,activeProject:agent.activeProject,canSteer:agent.steerable,approval:agent.approval,update:updates?.state,tapirProgress});
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
async function attachFiles(projectId,sessionId) {
  store.assertActive(projectId, await store.session(projectId,sessionId));
  const chosen=await dialog.showOpenDialog(win,{title:t('errors.addProjectMaterials'),properties:['openFile','multiSelections']});
  if(chosen.canceled)return [];
  const result=[],root=await store.workspace(projectId,sessionId);
  for(const file of chosen.filePaths) {
    const name=path.basename(file),relative=`attachments/${crypto.randomUUID()}-${name}`,destination=await projectPath(root,relative);
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
const handlers={
  bootstrap:async()=>publicState(),
  providerDefinitions:async()=>providerDefinitions,
  answerProviderPrompt:async input=>{answerProviderPrompt(input);return true;},
  connectOAuth:async({definitionId,id})=>{
    if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));
    let registrationId;
    const registrations=!id&&(store.state.oauthRegistrations||[]).filter(p=>p.definitionId===definitionId);
    if(registrations?.length) {
      const buttons=[...registrations.map(p=>p.oauth.accountName),t('ui.oauthDifferentAccount'),t('ui.cancel')];
      const {response}=await showProviderPrompt({kind:'account',definitionId,message:t('ui.oauthChooseAccount'),
        detail:t('ui.oauthChooseAccountDescription'),buttons,defaultId:registrations.length-1,cancelId:buttons.length-1});
      if(response===buttons.length-1)throw new Error(t('errors.oauthCancelled'));
      registrationId=registrations[response]?.id||null;
    }
    if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));
    const providerId=await store.oauthManager.connect(definitionId,id,registrationId);
    const provider=store.state.providers.find(p=>p.id===providerId),definition=providerDefinitions.find(d=>d.id===definitionId);
    store.selectModel(providerId);await store.save();
    if(provider.oauth.planEnabled&&!(store.state.planNotices||[]).includes(definitionId)) {
      showAppWindow(win);
      await showProviderPrompt({kind:'info',definitionId,message:t(definition.planLabel),detail:t('ui.planWelcome'),buttons:[t('ui.gotIt')],defaultId:0,cancelId:0});
      store.state.planNotices=[...(store.state.planNotices||[]),definitionId];await store.save();
    }
    showAppWindow(win);return {providerId,state:publicState()};
  },
  cancelOAuth:async()=>{store.oauthManager.cancel();return true;},
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
  sessionIndex:async()=>Promise.all([...store.state.projects.map(project=>project.id),INBOX_ID].map(async projectId=>{
    try{return {projectId,sessions:await store.sessions(projectId)};}
    catch(error){return {projectId,sessions:[],error:error.message};}
  })),
  session:async({projectId,id})=>{
    const s=await agent.snapshot(projectId,id);
    return {...s,history:undefined};
  },
  newSession:async({projectId})=>store.newSession(projectId),
  renameSession:async({projectId,id,title})=>agent.locked(async()=>{if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));const s=await store.session(projectId,id);s.title=String(title||'').trim().slice(0,100);if(!s.title)throw new Error(t('errors.enterAName'));await store.saveSession(s);return s.title;}),
  archiveSession:async({projectId,id,archived})=>agent.locked(async()=>{if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));await store.archiveSession(projectId,id,archived===true);return true;}),
  deleteSession:async({projectId,id})=>agent.locked(async()=>{if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));await store.deleteSession(projectId,id);return true;}),
  archiveProject:async({id,archived})=>agent.locked(async()=>{if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));await store.archiveProject(id,archived===true);return publicState();}),
  renameProject:async({id,name})=>agent.locked(async()=>{if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));await store.renameProject(id,name);return publicState();}),
  deleteProject:async({id})=>agent.locked(async()=>{if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));await store.deleteProject(id);return publicState();}),
  moveDraft:async({projectId,id,targetProjectId})=>agent.locked(async()=>{if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));return store.moveDraft(projectId,id,targetProjectId||INBOX_ID);}),
  saveProvider:async input=>{if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));await store.provider(input);return publicState();},
  deleteProvider:async({id})=>{
    if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));
    const provider=store.state.providers.find(p=>p.id===id);
    if(!provider)throw new Error(t('errors.providerNotFound'));
    const {response}=await showProviderPrompt({kind:'remove',definitionId:provider.definitionId,
      message:t('ui.providerRemoveConfirm',{name:provider.name}),
      detail:t(provider.oauth?'ui.oauthRemoveDescription':'ui.keyRemoveDescription',{account:provider.oauth?.accountName||provider.name}),
      buttons:[t('ui.cancel'),t(provider.oauth?'ui.oauthDisconnect':'ui.deleteProvider')],defaultId:0,cancelId:0});
    if(response!==1)return publicState();
    if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));
    if(provider.oauth)await store.oauthManager.disconnect(id);else await store.deleteProvider(id);
    return publicState();
  },
  models:async({id})=>{
    const p=store.getProvider(id),list=await models(p);
    const provider=store.state.providers.find(p=>p.id===id);if(!provider)return [];
    if(p.oauth&&(provider.oauth?.connectionId!==p.oauth.connectionId||provider.oauth.status!=='connected'||provider.oauth.planEnabled===false))return [];
    provider.models=list;
    provider.catalogVersion=2;provider.catalogUpdatedAt=Date.now();
    const accountCatalog=providerDefinitions.find(d=>d.id===provider.definitionId)?.accountCatalog;
    if(!provider.model||(accountCatalog&&!list.some(m=>m.id===provider.model)))provider.model=list[0]?.id||'';
    if(store.state.providerId===id&&(!store.state.model||accountCatalog))store.state.model=provider.model;
    await store.save();return list;
  },
  settings:async input=>{
    if(agent.running)throw new Error(t('errors.waitForTheTaskToFinish'));
    if(input.language!==undefined)await store.setLanguage(input.language);
    if(input.providerId!==undefined||input.model!==undefined)store.selectModel(input.providerId,input.model);
    if(input.reasoningEffort!==undefined) {
      if(!EFFORTS.includes(input.reasoningEffort))throw new Error(t('errors.invalidReasoning'));
      store.state.reasoningEffort=input.reasoningEffort;
    }
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
  directTool:async({projectId,sessionId,key,args,mode})=>agent.runDirect({projectId,sessionId},async(s,controller)=>{
    const m={id:crypto.randomUUID(),role:'tool',name:key,args,text:'',status:'running',at:Date.now()};
    s.messages.push(m);await store.saveSession(s);emit({type:'message',message:m,sessionId});
    let result;
    try {result=await agent.execute(s,'call_archicad',{name:key,arguments:args},mode,controller.signal);}
    catch(error){result={isError:true,error:error.message};}
    const artifact=await store.artifact(projectId,sessionId,key,result);
    Object.assign(m,{text:JSON.stringify(result).slice(0,24000),status:result.isError?'error':'done',artifact});
    await store.saveSession(s);emit({type:'message',message:m,sessionId});return m;
  }),
  send:async input=>{if(pendingProviderPrompt||store.oauthManager.pending||store.oauthManager.disconnecting.size)throw new Error(t('errors.oauthAlreadyConnecting'));return agent.enqueue(input);},
  queuedMessage:async input=>agent.changeQueued(input),
  resumeQueue:async input=>agent.resume(input),
  stop:async input=>agent.stop(input),
  approve:async({id,allowed})=>{agent.approve(id,allowed===true);return true;},
  attach:async({projectId,sessionId})=>attachFiles(projectId,sessionId),
  image:async({projectId,sessionId,relative})=>{
    const {mime,data}=await store.image(projectId,sessionId,decodeURIComponent(relative));
    return `data:${mime};base64,${data.toString('base64')}`;
  },
  revealWorkspace:async({projectId,sessionId})=>{
    await store.session(projectId,sessionId);const error=await shell.openPath(await store.workspace(projectId,sessionId));if(error)throw new Error(error);return true;
  },
  reveal:async({projectId,sessionId,relative})=>{
    const root=store.project(projectId).path;
    if(!relative){const error=await shell.openPath(root);if(error)throw new Error(error);return true;}
    let candidate = String(relative);
    if (/^file:/i.test(candidate)) candidate = fileURLToPath(candidate);
    if (/^[a-z]:(?:%5c|%2f)/i.test(candidate)) candidate = decodeURIComponent(candidate);
    // Revealing is an explicit user click and never executes the target file.
    // Generated relative paths still resolve against the chat/project scopes.
    if (path.isAbsolute(candidate)) {
      try { await fs.access(candidate); } catch (error) { const decoded=decodeURIComponent(candidate); if(decoded===candidate)throw error; await fs.access(decoded); candidate=decoded; }
      shell.showItemInFolder(candidate); return true;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(candidate) && !/^(project|session):\//.test(candidate)) throw new Error(t('errors.expectedAFileName'));
    let location;
    try { location = await store.resolveFile(projectId,sessionId,candidate); }
    catch (error) {
      let decoded; try { decoded = decodeURIComponent(candidate); } catch { throw error; }
      if (decoded !== candidate) { try { location = await store.resolveFile(projectId,sessionId,decoded); } catch {} }
      if (!location && !/^(project|session):\//.test(candidate)) location = await store.resolveFile(projectId,sessionId,decoded,{scope:'project'});
      if (!location) throw error;
    }
    shell.showItemInFolder(location.file);return true;
  },
  exportSession:async({projectId,id})=>{
    const s=await store.session(projectId,id);
    const relative=t('errors.reportMd',{value0:new Date().toISOString().slice(0,10),value1:id.slice(0,8)});
    const chosen=await dialog.showSaveDialog(win,{defaultPath:path.join(app.getPath('documents'),relative),filters:[{name:'Markdown',extensions:['md']}]});
    if(chosen.canceled||!chosen.filePath)return null;const file=chosen.filePath;
    await fs.writeFile(file,`# ${s.title}\n\n`+s.messages.map(m=>`## ${m.role==='user'?t('ui.you'):m.role==='assistant'?'Archi Helper':m.name||t('errors.system')}\n\n${m.text}\n${m.artifact?t('errors.fullResult',{value0:m.artifact.path}):''}`).join('\n\n'),'utf8');shell.showItemInFolder(file);return file;
  },
  installTapir:async()=>{
    if(tapirInstalling)throw new Error(t('errors.waitForTheTaskToFinish'));
    tapirInstalling=true;
    try{return await installTapir({fetch:appFetch,folder:path.join(app.getPath('userData'),'addons'),openPath:file=>shell.openPath(file),onProgress:reportTapirProgress});}
    catch(error){reportTapirProgress({status:'error',message:error.message});throw error;}
    finally{tapirInstalling=false;}
  },
  launchArchicad:async()=>{
    const chosen=await dialog.showOpenDialog(win,{title:t('errors.openProjectInArchicad'),filters:[{name:t('errors.archicadProject'),extensions:['pln','pla','tpl']}],properties:['openFile']});
    if(chosen.canceled)return false;const error=await shell.openPath(chosen.filePaths[0]);if(error)throw new Error(error);return true;
  },
  external:async({url})=>{const u=new URL(url);if(u.protocol!=='https:')throw new Error(t('errors.onlyHttpsLinksAreAllowed'));await shell.openExternal(u.toString());},
  window:async({action})=>{if(action==='minimize')win.minimize();else if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();else if(action==='close')win.close();}
};
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{showAppWindow(win);});
  app.whenReady().then(async()=>{
  app.setAppUserModelId('app.ac-helper.archi');
  Menu.setApplicationMenu(null);
  const networkSession=session.fromPartition('network',{cache:false});
  await networkSession.setProxy({mode:'system'});
  configureAppFetch((input,init)=>networkSession.fetch(input,{...init,credentials:'omit',cache:'no-store'}));
  store=new Store(app.getPath('userData'),{
    encrypt:value=>{if(!safeStorage.isEncryptionAvailable())throw new Error(t('errors.windowsEncryptionIsUnavailable'));return safeStorage.encryptString(value).toString('base64');},
    decrypt:value=>safeStorage.decryptString(Buffer.from(value,'base64'))
  });
   await store.init(app.getLocale());store.oauthManager=new OAuthManager(store,{openExternal:url=>shell.openExternal(url)});connection={connected:false,message:t('ui.connectingAlt')};mcp=new MCP(runtime);agent=new Agent(store,mcp,emit);
  updates=createUpdates({updater:updaterModule.autoUpdater,enabled:app.isPackaged&&process.platform==='win32'&&!process.env.PORTABLE_EXECUTABLE_FILE,version:app.getVersion(),getBusy:()=>!!agent.running||activeCalls>0,emit,install:()=>installUpdate({app,win,updater:updaterModule.autoUpdater,update:updates.state,language:store.state.language})});
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
  const painted=new Promise(resolve=>win.once('ready-to-show',resolve));
  if(!app.isPackaged && process.env.ARCHI_DEV_URL)await win.loadURL(process.env.ARCHI_DEV_URL);else await win.loadFile(path.resolve(here,'../dist/index.html'));
  await painted;
  if(!showAppWindow(win))throw new Error(t('errors.couldNotShowWindow'));
  process.send?.({type:'archi-ready',version:app.getVersion()});
  const cleanupTimer=setTimeout(()=>cleanupUpdateHelper(app).catch(()=>{}),1000);cleanupTimer.unref();
  updates.start();connect();
  win.on('close',event=>{
    if(agent.running){event.preventDefault();dialog.showMessageBox(win,{type:'question',message:t('errors.stopTheTaskAndCloseArchiHelper'),detail:t('errors.changesAlreadyMadeInArchicadWillNot'),buttons:[t('errors.keepWorking'),t('errors.stopAndClose')],defaultId:0,cancelId:0}).then(({response})=>{if(response===1){agent.stop().catch(()=>{});setTimeout(()=>win.destroy(),500);}});}
  });
  app.on('window-all-closed',()=>app.quit());
   let quitting=false;app.on('before-quit',event=>{if(!quitting){event.preventDefault();quitting=true;if(pendingProviderPrompt)answerProviderPrompt({id:pendingProviderPrompt.prompt.id,response:pendingProviderPrompt.prompt.cancelId});updates.dispose();store.oauthManager.dispose();Promise.allSettled([agent.stop(),mcp.close()]).finally(()=>app.quit());}});
  }).catch(error=>{dialog.showErrorBox(t('errors.archiHelperStartupError'),error.message);app.quit();});
}
