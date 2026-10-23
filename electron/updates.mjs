// Keep installation separate from download: an update must not interrupt work.
export function createUpdates({updater,enabled,version,getBusy,emit,install,
  schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout}) {
  let state={status:enabled?'idle':'disabled',version},idle=false,ready=false,deferred=false,timer=null,checking=null;
  let started=false,disposed=false,checkTimer=null;
  const publish=patch=>{if(disposed)return;state={...state,...patch};emit({type:'update',update:state});};
  const cancelInstall=()=>{if(timer!==null){cancel(timer);timer=null;}};
  const cancelCheck=()=>{if(checkTimer!==null){cancel(checkTimer);checkTimer=null;}};
  const scheduleCheck=delay=>{
    cancelCheck();
    if(!started||disposed||ready)return;
    checkTimer=schedule(()=>{checkTimer=null;return check();},delay);
    checkTimer?.unref?.();
  };
  const fail=()=>{
    ready=false;cancelInstall();publish({status:'error',restartAt:null});
    if(!checking)scheduleCheck(60000);
  };
  const beginInstall=()=>{
    if(disposed||!enabled||!ready||state.status==='installing'||!idle||getBusy())return state;
    cancelInstall();
    publish({status:'installing',stage:'preparing',restartAt:null});
    // Give the renderer one paint before the native installer takes over.
    timer=schedule(()=>{timer=null;if(!disposed){try{Promise.resolve(install()).catch(fail);}catch{fail();}}},500);
    timer?.unref?.();
    return state;
  };
  const reconcile=()=>{
    if(disposed||state.status==='installing')return;
    cancelInstall();
    if(!ready||deferred||!idle||getBusy()){
      if(ready&&state.status!=='installing')publish({status:'ready',restartAt:null});
      return;
    }
    publish({status:'countdown',restartAt:Date.now()+3000});
    timer=schedule(()=>{
      timer=null;
      if(!idle||deferred||getBusy())return reconcile();
      beginInstall();
    },3000);
    timer?.unref?.();
  };
  if(enabled){
    updater.autoDownload=true;
    updater.autoInstallOnAppQuit=false; // Never start an installer during Windows shutdown.
    updater.allowPrerelease=false;
    updater.allowDowngrade=false;
    updater.disableWebInstaller=true;
    updater.on('checking-for-update',()=>publish({status:'checking',nextVersion:null,percent:0,transferred:0,total:0,bytesPerSecond:0,restartAt:null}));
    updater.on('update-available',info=>publish({status:'downloading',nextVersion:info.version,percent:0}));
    updater.on('download-progress',info=>publish({status:'downloading',percent:Math.max(0,Math.min(100,Math.round(info.percent||0))),transferred:info.transferred,total:info.total,bytesPerSecond:info.bytesPerSecond}));
    updater.on('update-not-available',()=>publish({status:'current'}));
    updater.on('update-downloaded',info=>{
      ready=true;
      cancelCheck();
      publish({status:'ready',nextVersion:info.version,percent:100});
      reconcile();
    });
    updater.on('error',fail);
  }
  function check(){
    if(!enabled||disposed||ready)return Promise.resolve(state);
    if(checking)return checking.then(()=>state);
    cancelCheck();
    checking=Promise.resolve().then(async()=>{
      const result=await updater.checkForUpdates();
      // electron-updater resolves the check before its automatic download ends.
      await result?.downloadPromise;
    }).catch(fail).finally(()=>{
      checking=null;
      scheduleCheck(state.status==='error'?60000:3600000);
    });
    return checking.then(()=>state);
  }
  return {
    get state(){return state;},
    start(){
      if(!enabled||started||disposed)return Promise.resolve(state);
      started=true;return check();
    },
    setIdle(value){idle=value===true;reconcile();return state;},
    workChanged(){reconcile();},
    restartNow(){return beginInstall();},
    defer(){deferred=true;publish({deferred:true});reconcile();return state;},
    check(){
      if(deferred){deferred=false;publish({deferred:false});reconcile();}
      return check();
    },
    dispose(){disposed=true;cancelCheck();cancelInstall();}
  };
}
