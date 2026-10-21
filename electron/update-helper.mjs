import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(await fs.readFile(path.join(here,'config.json'),'utf8'));
app.setPath('userData',path.join(config.root,'profile'));
// The installer's forced launch may reopen this helper while it is still alive.
if(!app.requestSingleInstanceLock())app.exit();
let win,canClose=false,launching=false;
let update={...config.update,status:'installing',stage:'preparing',restartAt:null};
const publish=patch=>{
  update={...update,...patch};
  if(win&&!win.isDestroyed())win.webContents.send('archi:event',{type:'update',update});
};
function restart(applied=true){
  if(launching)return;
  launching=true;publish({status:'installing',stage:applied?'restarting':'reopening'});
  const env={...process.env,ARCHI_UPDATE_HELPER_DIR:config.root};
  delete env.ARCHI_UPDATE_STATUS_FILE;delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(config.executable,[...config.args,...(applied?['--updated']:[])],{cwd:path.dirname(config.executable),detached:true,env,stdio:['ignore','ignore','ignore','ipc']});
  const timeout=setTimeout(failed,60000);
  function failed(){clearTimeout(timeout);launching=false;publish({status:'error'});}
  child.once('error',failed);
  child.once('exit',failed);
  child.on('message',message=>{
    if(message?.type!=='archi-ready'||(applied&&message.version!==config.update.nextVersion))return;
    clearTimeout(timeout);child.removeListener('exit',failed);
    child.disconnect();child.unref();canClose=true;app.quit();
  });
}
process.on('message',message=>{if(message?.type==='abort'){canClose=true;app.quit();}});
app.whenReady().then(async()=>{
  app.setAppUserModelId('app.ac-helper.archi');
  win=new BrowserWindow({...config.bounds,minWidth:1000,minHeight:680,show:false,frame:false,title:'Archi Helper',backgroundColor:'#fcfcf9',icon:path.join(here,'ui','icon.png'),webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.on('close',event=>{if(!canClose&&update.status!=='error')event.preventDefault();});
  ipcMain.handle('archi:call',async(event,method,input={})=>{
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)return {ok:false,error:'Untrusted request'};
    if(method==='bootstrap')return {ok:true,value:{language:config.language,appVersion:config.update.version,updateOnly:true,projects:[],providers:[],providerId:'',model:'',archicadPort:'',connection:{connected:false},toolCount:0,runtimeReady:false,busy:false,update}};
    if(method==='updateIdle')return {ok:true,value:update};
    if(method==='checkUpdates'&&update.status==='error'){
      const installed=await fs.readFile(config.statusFile,'utf8').catch(()=>'');
      restart(installed==='complete');return {ok:true,value:update};
    }
    if(method==='window'&&input.action==='minimize'){win.minimize();return {ok:true};}
    return {ok:false,error:'Update in progress'};
  });
  const painted=new Promise(resolve=>win.once('ready-to-show',resolve));
  await win.loadFile(path.join(here,'ui','index.html'));
  await painted;
  if(config.maximized)win.maximize();
  win.show();process.send?.({type:'archi-update-ready'});
  const started=Date.now();let reading=false;
  const timer=setInterval(async()=>{
    if(reading)return;
    reading=true;
    try{
      const ready=await fs.readFile(path.join(config.root,'app-ready.json'),'utf8').then(JSON.parse).catch(()=>null);
      if(ready?.version===config.update.nextVersion){canClose=true;app.quit();return;}
      if(launching||update.status==='error')return;
      const status=await fs.readFile(config.statusFile,'utf8').catch(()=>'');
      if(status==='applying'&&update.stage!=='applying')publish({stage:'applying'});
      else if(status==='complete')restart();
      else if(status==='error')publish({status:'error'});
      else if(Date.now()-started>20*60*1000)publish({status:'error'});
    }finally{reading=false;}
  },500);
  app.on('before-quit',()=>clearInterval(timer));
}).catch(()=>{canClose=true;app.quit();});
app.on('window-all-closed',()=>app.quit());
